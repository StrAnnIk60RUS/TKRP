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

    screen_name = url.split("/")[-1].split("?")[0]

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
        resp = requests.get(api_url, params=params, timeout=30)
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
        if follower_count is not None:
            for post in posts:
                post.follower_count = follower_count

        print(f"Fetched {len(posts)} VK posts via API for '{screen_name}'.")
        return posts

    except requests.RequestException as e:
        raise VKParserError(f"VK API request failed for '{screen_name}': {e}")


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


def parse_instagram_account(url: str) -> List[VKPost]:
    """Parse recent posts from a public Instagram profile via the web profile API."""
    username = extract_instagram_username(url)
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
            "Задайте INSTAGRAM_COOKIE в .env (cookie авторизованной сессии)."
        )
    if not resp.ok:
        raise InstagramParserError(f"Instagram HTTP {resp.status_code} для '{username}'")

    try:
        payload = resp.json()
    except ValueError as exc:
        raise InstagramParserError(
            f"Instagram вернул не JSON для '{username}'. Задайте INSTAGRAM_COOKIE в .env."
        ) from exc

    user = (payload.get("data") or {}).get("user") or {}
    media = ((user.get("edge_owner_to_timeline_media") or {}).get("edges")) or []
    if not isinstance(media, list) or not media:
        if user.get("is_private"):
            raise InstagramParserError(
                f"Профиль '{username}' закрыт. Нужна сессия с доступом (INSTAGRAM_COOKIE)."
            )
        raise InstagramParserError(
            f"Instagram не вернул посты для '{username}'. Проверьте ссылку и INSTAGRAM_COOKIE."
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
                attachments=[{"type": "video" if node.get("is_video") else "photo"}],
                follower_count=follower_count,
            )
        )

    if not posts:
        raise InstagramParserError(f"У профиля '{username}' нет постов с текстом.")
    print(f"Fetched {len(posts)} Instagram posts for '{username}'.")
    return posts