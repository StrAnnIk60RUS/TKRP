import json
import os
import re
from dataclasses import dataclass, asdict
from datetime import datetime
from typing import Optional, Dict, Any, List
from urllib.parse import urlparse

import requests
from dotenv import load_dotenv

# Загружаем единый .env из корня проекта
load_dotenv(os.path.join(os.path.dirname(__file__), '..', '..', '.env'))


@dataclass
class VKPost:
    """Модель данных для одного поста ВКонтакте."""
    url: str
    account_name: Optional[str]
    text: Optional[str]
    likes: Optional[int]
    comments: Optional[int]
    reposts: Optional[int]
    datetime: Optional[str]
    views: Optional[int] = None
    attachments: Optional[List[Dict[str, Any]]] = None
    follower_count: Optional[int] = None
    platform: Optional[str] = None


UniversalPost = VKPost


class VKParserError(Exception):
    """Базовое исключение парсера ВКонтакте."""


def _parse_int_safe(value: Optional[str]) -> Optional[int]:
    if not value:
        return None
    value = value.replace("\u00a0", " ").strip()
    try:
        return int(value.replace(" ", "").replace(",", ""))
    except ValueError:
        lower = value.lower()
        mult = 1
        if lower.endswith("k"):
            mult = 1_000
            num = lower[:-1]
        elif lower.endswith("m"):
            mult = 1_000_000
            num = lower[:-1]
        else:
            return None
        try:
            return int(float(num.replace(",", ".").strip()) * mult)
        except ValueError:
            return None


def save_post_to_json(post: VKPost, json_path: str = "posts.json") -> None:
    """Save single post into JSON file (append to 'posts' list)."""
    data: Dict[str, Any] = {}
    try:
        with open(json_path, "r", encoding="utf-8") as f:
            try:
                content = f.read().strip()
                if content:
                    data = json.loads(content)
                else:
                    data = {"posts": []}
            except json.JSONDecodeError:
                data = {"posts": []}
    except FileNotFoundError:
        data = {"posts": []}

    if "posts" not in data or not isinstance(data["posts"], list):
        data["posts"] = []

    data["posts"].append(asdict(post))

    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def save_posts_to_json(posts: List[VKPost], json_path: str = "posts.json") -> None:
    """Save list of posts into JSON file (append to 'posts' list)."""
    data: Dict[str, Any] = {}
    try:
        with open(json_path, "r", encoding="utf-8") as f:
            try:
                content = f.read().strip()
                if content:
                    data = json.loads(content)
                else:
                    data = {"posts": []}
            except json.JSONDecodeError:
                data = {"posts": []}
    except FileNotFoundError:
        data = {"posts": []}

    if "posts" not in data or not isinstance(data["posts"], list):
        data["posts"] = []

    for post in posts:
        data["posts"].append(asdict(post))

    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def _fetch_vk_follower_count(screen_name: str, api_token: str) -> Optional[int]:
    """Best-effort follower/member count. Parsing posts still succeeds if this fails."""
    if not api_token or not screen_name:
        return None

    def _count_from(payload: Dict[str, Any], key: str) -> Optional[int]:
        response = payload.get("response")
        rows = response
        if isinstance(response, dict):
            rows = response.get("groups") or response.get("users") or [response]
        if isinstance(rows, list) and rows and isinstance(rows[0], dict):
            value = rows[0].get(key)
            if isinstance(value, int) and value >= 0:
                return value
        return None

    try:
        group_resp = requests.get(
            "https://api.vk.com/method/groups.getById",
            params={
                "group_id": screen_name,
                "fields": "members_count",
                "access_token": api_token,
                "v": "5.131",
            },
            timeout=15,
        )
        if group_resp.ok:
            count = _count_from(group_resp.json(), "members_count")
            if count is not None:
                return count
    except (requests.RequestException, ValueError):
        pass

    try:
        user_resp = requests.get(
            "https://api.vk.com/method/users.get",
            params={
                "user_ids": screen_name,
                "fields": "followers_count",
                "access_token": api_token,
                "v": "5.131",
            },
            timeout=15,
        )
        if user_resp.ok:
            return _count_from(user_resp.json(), "followers_count")
    except (requests.RequestException, ValueError):
        return None
    return None


def parse_vk_account(url: str, headers: Optional[Dict[str, str]] = None) -> List[VKPost]:
    """Parse posts from VK account / group using VK API only (без Selenium)."""
    if not url.startswith("http"):
        url = "https://" + url

    path_parts = [p for p in url.split("?")[0].split("/") if p]
    screen_name = path_parts[-1] if path_parts else ''

    # --- VK API (только API, без Selenium) ---
    api_token = os.getenv("VK_API_TOKEN", "")
    if not api_token:
        raise VKParserError(
            "VK_API_TOKEN не установлен в переменных окружения. "
            "Парсинг VK настроен только через VK API, Selenium не используется."
        )

    api_url = "https://api.vk.com/method/wall.get"
    params = {
        "domain": screen_name,
        "count": 100,
        "access_token": api_token,
        "v": "5.131",
    }

    try:
        resp = requests.post(api_url, data=params, timeout=30)
        if not resp.ok:
            raise VKParserError(f"VK API HTTP error for '{screen_name}': {resp.status_code}")

        data = resp.json()
        if "error" in data:
            err = data["error"]
            raise VKParserError(
                f"VK API error for '{screen_name}': {err.get('error_msg', 'unknown error')}"
            )

        if "response" not in data or "items" not in data["response"]:
            raise VKParserError(f"VK API unexpected response format for '{screen_name}'")

        items = data["response"]["items"]
        posts: List[VKPost] = []
        account_name = screen_name

        for item in items:
            post_text = item.get("text", "")
            if not post_text:
                continue

            post_date = item.get("date", 0)
            if post_date:
                dt = datetime.fromtimestamp(post_date)
                post_date_str = dt.strftime("%Y-%m-%d %H:%M:%S")
            else:
                post_date_str = None

            likes_count = None
            if "likes" in item and isinstance(item["likes"], dict):
                likes_count = item["likes"].get("count", 0)

            comments_count = None
            if "comments" in item and isinstance(item["comments"], dict):
                comments_count = item["comments"].get("count", 0)

            reposts_count = None
            if "reposts" in item and isinstance(item["reposts"], dict):
                reposts_count = item["reposts"].get("count", 0)

            views_count = None
            if "views" in item and isinstance(item["views"], dict):
                views_count = item["views"].get("count", None)

            attachments = item.get("attachments") if isinstance(item.get("attachments"), list) else None

            owner_id = item.get("owner_id", 0)
            post_id = item.get("id", 0)
            post_url = f"https://vk.com/{screen_name}?w=wall{owner_id}_{post_id}"

            posts.append(
                VKPost(
                    url=post_url,
                    account_name=account_name,
                    text=post_text,
                    likes=likes_count,
                    comments=comments_count,
                    reposts=reposts_count,
                    datetime=post_date_str,
                    views=views_count,
                    attachments=attachments,
                )
            )

        if not posts:
            raise VKParserError(f"VK API returned no posts for '{screen_name}'")

        follower_count = _fetch_vk_follower_count(screen_name, api_token)
        for post in posts:
            post.platform = "vk"
            if follower_count is not None:
                post.follower_count = follower_count

        print(f"Fetched {len(posts)} VK posts via API for '{screen_name}'.")
        return posts

    except requests.RequestException as e:
        sanitized_e = re.sub(r'(access_token|token)=[^&\s]+', r'\1=[REDACTED]', str(e))
        raise VKParserError(f"VK API request failed for '{screen_name}': {sanitized_e}")


class InstagramParserError(Exception):
    """Ошибка парсинга публичного профиля Instagram."""


_IG_RESERVED_PATHS = {
    "p",
    "reel",
    "reels",
    "stories",
    "explore",
    "accounts",
    "direct",
    "about",
    "legal",
    "tv",
}


def extract_instagram_username(url: str) -> str:
    raw = url.strip()
    if not raw.startswith("http"):
        raw = "https://" + raw
    parsed = urlparse(raw)
    host = parsed.netloc.lower()
    if host.startswith("www."):
        host = host[4:]
    if host not in {"instagram.com", "instagr.am"}:
        raise InstagramParserError(f"URL is not an Instagram profile: {url}")
    parts = [part for part in parsed.path.split("/") if part]
    if not parts or parts[0].lower() in _IG_RESERVED_PATHS:
        raise InstagramParserError(
            "Нужна ссылка на профиль Instagram (https://www.instagram.com/username/), а не на отдельный пост."
        )
    username = parts[0].strip()
    if not re.fullmatch(r"[A-Za-z0-9._]{1,30}", username):
        raise InstagramParserError(f"Некорректное имя профиля Instagram: {username}")
    return username


def _instagram_cookie_headers(cookie: str) -> Dict[str, str]:
    headers: Dict[str, str] = {}
    if not cookie:
        return headers
    headers["Cookie"] = cookie
    for part in cookie.split(";"):
        piece = part.strip()
        if piece.lower().startswith("csrftoken="):
            token = piece.split("=", 1)[1].strip()
            if token:
                headers["X-CSRFToken"] = token
            break
    return headers


def _parse_instagram_via_apify(username: str, token: str) -> List[VKPost]:
    """Parse recent posts from an Instagram profile using Apify's Instagram Scraper."""
    profile_url = f"https://www.instagram.com/{username}/"
    actor_endpoint = (
        "https://api.apify.com/v2/actors/apify~instagram-scraper/run-sync-get-dataset-items"
    )
    payload = {
        "resultsType": "posts",
        "directUrls": [profile_url],
        "resultsLimit": 30,
    }
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {token}",
        "User-Agent": "TKRP-Content-Planner/1.0",
    }

    try:
        resp = requests.post(
            actor_endpoint,
            json=payload,
            headers=headers,
            timeout=120,
        )
    except requests.RequestException as exc:
        sanitized_exc = re.sub(r'(access_token|token)=[^&\s]+', r'\1=[REDACTED]', str(exc))
        raise InstagramParserError(f"Apify request failed for '{username}': {sanitized_exc}") from None

    if resp.status_code == 401:
        raise InstagramParserError("Неверный APIFY_API_TOKEN в .env")
    if not resp.ok:
        raise InstagramParserError(f"Apify Instagram Scraper error ({resp.status_code}): {resp.text[:200]}")

    try:
        items = resp.json()
    except ValueError as exc:
        raise InstagramParserError("Apify вернул некорректный ответ (не JSON)") from exc

    if not isinstance(items, list):
        raise InstagramParserError("Apify вернул неожиданный формат ответа")

    posts: List[VKPost] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        # Caption / text
        text = str(item.get("caption") or "").strip()
        if not text:
            continue

        short_code = item.get("shortCode") or item.get("code")
        post_url = (
            item.get("url")
            or (f"https://www.instagram.com/p/{short_code}/" if short_code else profile_url)
        )

        account_name = (
            item.get("ownerFullName")
            or item.get("ownerUsername")
            or username
        )

        likes = item.get("likesCount")
        comments = item.get("commentsCount")
        views = item.get("videoViewCount") or item.get("videoPlayCount")
        follower_count = (
            item.get("followersCount")
            or item.get("ownerFollowersCount")
        )

        # Datetime formatting (ISO 8601 -> YYYY-MM-DD HH:MM:SS)
        post_date = None
        raw_ts = item.get("timestamp")
        if raw_ts and isinstance(raw_ts, str):
            try:
                # Handle ISO timestamps like 2026-03-15T12:00:00.000Z
                clean_ts = raw_ts.replace("Z", "+00:00")
                dt = datetime.fromisoformat(clean_ts)
                post_date = dt.strftime("%Y-%m-%d %H:%M:%S")
            except (ValueError, TypeError):
                post_date = raw_ts[:19].replace("T", " ")

        post_type = str(item.get("type") or "").lower()
        is_video = "video" in post_type or item.get("videoUrl") is not None
        is_carousel = "sidecar" in post_type or bool(item.get("childPosts")) or bool(item.get("images"))
        if is_carousel:
            child_count = len(item.get("childPosts") or item.get("images") or []) or 2
            attachments = [{"type": "carousel", "items_count": child_count}, {"type": "photo"}]
        elif is_video:
            attachments = [{"type": "video"}]
        else:
            attachments = [{"type": "photo"}]

        posts.append(
            VKPost(
                url=post_url,
                account_name=str(account_name) if account_name else username,
                text=text,
                likes=int(likes) if isinstance(likes, (int, float)) and likes >= 0 else None,
                comments=int(comments) if isinstance(comments, (int, float)) and comments >= 0 else None,
                reposts=0,
                datetime=post_date,
                views=int(views) if isinstance(views, (int, float)) and views >= 0 else None,
                attachments=attachments,
                follower_count=int(follower_count) if isinstance(follower_count, (int, float)) and follower_count >= 0 else None,
                platform="instagram",
            )
        )

    if not posts:
        raise InstagramParserError(f"У профиля '{username}' не найдено постов с текстом через Apify.")

    print(f"Fetched {len(posts)} Instagram posts for '{username}' via Apify.")
    return posts


def _parse_instagram_via_web(username: str) -> List[VKPost]:
    """Parse recent posts from a public Instagram profile via the legacy web profile API."""
    cookie = os.getenv("INSTAGRAM_COOKIE", "").strip()
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/145.0.0.0 Safari/537.36"
        ),
        "Accept": "*/*",
        "Accept-Language": "en-US,en;q=0.9",
        "X-IG-App-ID": "936619743392459",
        "X-Requested-With": "XMLHttpRequest",
        "Referer": f"https://www.instagram.com/{username}/",
    }
    headers.update(_instagram_cookie_headers(cookie))

    try:
        resp = requests.get(
            "https://www.instagram.com/api/v1/users/web_profile_info/",
            params={"username": username},
            headers=headers,
            timeout=30,
        )
    except requests.RequestException as exc:
        raise InstagramParserError(f"Instagram request failed for '{username}': {exc}") from exc

    if resp.status_code in (401, 403, 429):
        raise InstagramParserError(
            f"Instagram ограничил доступ ({resp.status_code}) для '{username}'. "
            "Задайте APIFY_API_TOKEN или INSTAGRAM_COOKIE в .env."
        )
    if not resp.ok:
        raise InstagramParserError(f"Instagram HTTP {resp.status_code} для '{username}'")

    try:
        payload = resp.json()
    except ValueError as exc:
        raise InstagramParserError(
            f"Instagram вернул не JSON для '{username}'. Задайте APIFY_API_TOKEN в .env."
        ) from exc

    user = (payload.get("data") or {}).get("user") or {}
    media = ((user.get("edge_owner_to_timeline_media") or {}).get("edges")) or []
    if not isinstance(media, list) or not media:
        if user.get("is_private"):
            raise InstagramParserError(
                f"Профиль '{username}' закрыт. Нужна сессия с доступом."
            )
        raise InstagramParserError(
            f"Instagram не вернул посты для '{username}'. Проверьте ссылку или задайте APIFY_API_TOKEN."
        )

    account_name = user.get("full_name") or user.get("username") or username
    followed_by = user.get("edge_followed_by") or {}
    follower_count = followed_by.get("count") if isinstance(followed_by, dict) else None
    if not isinstance(follower_count, int):
        follower_count = None
    posts: List[VKPost] = []
    for edge in media:
        node = edge.get("node") if isinstance(edge, dict) else None
        if not isinstance(node, dict):
            continue
        caption_edges = ((node.get("edge_media_to_caption") or {}).get("edges")) or []
        text = ""
        if caption_edges and isinstance(caption_edges[0], dict):
            text = str(((caption_edges[0].get("node") or {}).get("text")) or "")
        text = text.strip()
        if not text:
            continue
        shortcode = str(node.get("shortcode") or "")
        post_url = (
            f"https://www.instagram.com/p/{shortcode}/"
            if shortcode
            else f"https://www.instagram.com/{username}/"
        )
        taken = node.get("taken_at_timestamp")
        post_date = None
        if isinstance(taken, (int, float)) and taken > 0:
            post_date = datetime.fromtimestamp(int(taken)).strftime("%Y-%m-%d %H:%M:%S")
        likes_obj = node.get("edge_liked_by") or node.get("edge_media_preview_like") or {}
        comments_obj = node.get("edge_media_to_comment") or {}
        likes = likes_obj.get("count") if isinstance(likes_obj, dict) else None
        comments = comments_obj.get("count") if isinstance(comments_obj, dict) else None
        views = node.get("video_view_count") if node.get("is_video") else None
        is_sidecar = node.get("__typename") == "GraphSidecar"
        if is_sidecar:
            attachments = [{"type": "carousel"}, {"type": "photo"}]
        elif node.get("is_video"):
            attachments = [{"type": "video"}]
        else:
            attachments = [{"type": "photo"}]

        posts.append(
            VKPost(
                url=post_url,
                account_name=account_name,
                text=text,
                likes=likes if isinstance(likes, int) else None,
                comments=comments if isinstance(comments, int) else None,
                reposts=0,
                datetime=post_date,
                views=views if isinstance(views, int) else None,
                attachments=attachments,
                follower_count=follower_count,
                platform="instagram",
            )
        )

    if not posts:
        raise InstagramParserError(f"У профиля '{username}' нет постов с текстом.")
    print(f"Fetched {len(posts)} Instagram posts for '{username}'.")
    return posts


def parse_instagram_account(url: str) -> List[VKPost]:
    """Parse recent posts from a public Instagram profile (prefers Apify, falls back to web API)."""
    username = extract_instagram_username(url)
    apify_token = os.getenv("APIFY_API_TOKEN", "").strip()

    if apify_token:
        try:
            return _parse_instagram_via_apify(username, apify_token)
        except InstagramParserError as exc:
            # If Apify fails (e.g. rate limit reached), log warning and attempt web fallback if cookie is provided
            print(f"Warning: Apify Instagram parse failed: {exc}. Trying fallback...")
            if not os.getenv("INSTAGRAM_COOKIE", "").strip():
                raise

    return _parse_instagram_via_web(username)



class TelegramParserError(VKParserError):
    """Ошибка парсинга Telegram-канала."""


_TG_RESERVED_PATHS = {
    "joinchat",
    "addstickers",
    "share",
    "login",
    "c",
    "s",
    "iv",
    "contact",
    "socks",
    "proxy",
    "addtheme",
    "setlanguage",
}


def extract_telegram_channel(url: str) -> str:
    """Извлекает валидный username Telegram-канала из ссылки или @username."""
    raw = url.strip()
    if raw.startswith("@"):
        channel = raw[1:].strip()
    else:
        if not raw.startswith("http"):
            raw = "https://" + raw
        parsed = urlparse(raw)
        host = parsed.netloc.lower()
        if host.startswith("www."):
            host = host[4:]
        if host not in {"t.me", "telegram.me"}:
            raise TelegramParserError(f"URL is not a Telegram channel: {url}")
        parts = [part for part in parsed.path.split("/") if part]
        if not parts:
            raise TelegramParserError(f"Не указано имя Telegram-канала в ссылке: {url}")
        if parts[0].lower() == "s" and len(parts) > 1:
            channel = parts[1]
        else:
            channel = parts[0]

    channel = channel.split("?")[0].strip()
    if channel.lower() in _TG_RESERVED_PATHS or not re.fullmatch(r"[A-Za-z0-9_]{4,32}", channel):
        raise TelegramParserError(f"Некорректное имя Telegram-канала: {channel}")
    return channel


def parse_telegram_channel(url: str, limit: int = 30) -> List[VKPost]:
    """
    Парсит последние посты из публичного Telegram-канала через веб-версию https://t.me/s/{channel}.
    Не требует токенов, авторизации и API-ключей.
    """
    from bs4 import BeautifulSoup

    channel = extract_telegram_channel(url)
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/125.0.0.0 Safari/537.36"
        ),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7",
    }

    base_s_url = f"https://t.me/s/{channel}"
    current_url = base_s_url
    posts: List[VKPost] = []
    seen_urls = set()
    pages_checked = 0
    max_pages = 3

    account_name = channel
    follower_count = None

    while current_url and len(posts) < limit and pages_checked < max_pages:
        pages_checked += 1
        try:
            resp = requests.get(current_url, headers=headers, timeout=20)
        except requests.RequestException as exc:
            raise TelegramParserError(f"Ошибка запроса к Telegram для '{channel}': {exc}") from exc

        if resp.status_code == 404:
            raise TelegramParserError(f"Telegram-канал '{channel}' не найден или закрыт.")
        if not resp.ok:
            raise TelegramParserError(f"Telegram HTTP {resp.status_code} для '{channel}'")

        soup = BeautifulSoup(resp.text, "html.parser")

        if pages_checked == 1:
            title_node = soup.find("div", class_="tgme_channel_info_header_title")
            if title_node:
                account_name = title_node.get_text(strip=True) or channel
            counter_node = soup.find("div", class_="tgme_channel_info_counter")
            if counter_node:
                val_node = counter_node.find("span", class_="counter_value")
                cnt_str = val_node.get_text(strip=True) if val_node else counter_node.get_text(strip=True)
                follower_count = _parse_int_safe(cnt_str)

        messages = soup.find_all("div", class_="tgme_widget_message")
        if not messages:
            break

        for msg in reversed(messages):
            if len(posts) >= limit:
                break

            link_el = msg.find("a", class_="tgme_widget_message_date")
            post_url = link_el.get("href") if link_el else ""
            if not post_url or post_url in seen_urls:
                continue

            text_el = msg.find("div", class_="tgme_widget_message_text")
            text = text_el.get_text(separator="\n", strip=True) if text_el else ""
            if not text:
                continue

            seen_urls.add(post_url)

            post_date = None
            if link_el:
                time_el = link_el.find("time", class_="time") or link_el.find("time")
                if time_el and time_el.get("datetime"):
                    raw_dt = time_el.get("datetime")
                    try:
                        clean_dt = raw_dt.replace("Z", "+00:00")
                        dt = datetime.fromisoformat(clean_dt)
                        post_date = dt.strftime("%Y-%m-%d %H:%M:%S")
                    except Exception:
                        post_date = raw_dt[:19].replace("T", " ")

            views = None
            views_el = msg.find("span", class_="tgme_widget_message_views")
            if views_el:
                views = _parse_int_safe(views_el.get_text(strip=True))

            total_reactions = 0
            has_reactions = False
            for rx in msg.find_all("span", class_="tgme_reaction"):
                rx_text = rx.get_text(strip=True)
                m = re.search(r"(\d+(?:[.,]\d+)?\s*[kKmM]?)", rx_text)
                if m:
                    parsed_rx = _parse_int_safe(m.group(1))
                    if parsed_rx:
                        total_reactions += parsed_rx
                        has_reactions = True

            attachments = []
            has_photo = bool(
                msg.find("a", class_="tgme_widget_message_photo_wrap")
                or msg.find("div", class_="tgme_widget_message_photo_wrap")
            )
            has_video = bool(
                msg.find("div", class_="tgme_widget_message_video_player")
                or msg.find("video")
                or msg.find("i", class_="tgme_widget_message_video_thumb")
                or msg.find("div", class_="tgme_widget_message_roundvideo")
            )
            has_doc = bool(msg.find("div", class_="tgme_widget_message_document"))
            has_poll = bool(msg.find("div", class_="tgme_widget_message_poll"))

            if has_video:
                attachments.append({"type": "video"})
            elif has_photo:
                attachments.append({"type": "photo"})
            elif has_doc:
                attachments.append({"type": "doc"})
            elif has_poll:
                attachments.append({"type": "poll"})

            posts.append(
                VKPost(
                    url=post_url,
                    account_name=account_name,
                    text=text,
                    likes=total_reactions if has_reactions else 0,
                    comments=0,
                    reposts=0,
                    datetime=post_date,
                    views=views,
                    attachments=attachments if attachments else None,
                    follower_count=follower_count,
                    platform="telegram",
                )
            )

        prev_link = soup.find("a", class_="tme_messages_more") or soup.find("a", href=lambda h: bool(h and "before=" in h))
        if prev_link and prev_link.get("href") and len(posts) < limit:
            href = prev_link.get("href")
            current_url = f"https://t.me{href}" if href.startswith("/") else href
        else:
            break

    if not posts:
        raise TelegramParserError(f"У канала '{channel}' не найдено публичных постов с текстом.")

    print(f"Fetched {len(posts)} Telegram posts for '{channel}'.")
    return posts
