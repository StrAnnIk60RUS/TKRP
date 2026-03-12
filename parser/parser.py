import json
import re
import os
import html as html_lib
from dataclasses import dataclass, asdict
from datetime import datetime
from typing import Optional, Dict, Any, Tuple, List, Union

import requests
from bs4 import BeautifulSoup
from dotenv import load_dotenv

# Загружаем единый .env из корня проекта
load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))


@dataclass
class LinkedInPost:
    """Модель данных для одного поста LinkedIn."""
    url: str
    account_name: Optional[str]
    text: Optional[str]
    likes: Optional[int]
    datetime: Optional[str]


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


class LinkedInParserError(Exception):
    """Базовое исключение парсера LinkedIn."""


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


def _extract_from_bootstrap_json(
    soup: BeautifulSoup,
) -> Tuple[Optional[str], Optional[int], Optional[str], Optional[str]]:
    """
    Пытается вытащить данные (имя аккаунта, лайки, дату/время)
    из встроенного JSON, который LinkedIn кладёт в <code id="bpr-guid-...">.

    На странице-посте обычно есть объект ActorComponent с именем,
    и объект SocialActivityCounts с числом лайков.
    """
    account_name: Optional[str] = None
    likes: Optional[int] = None
    datetime_str: Optional[str] = None
    post_text: Optional[str] = None

    code_tags = soup.find_all("code", id=re.compile(r"^bpr-guid-"))

    for code_tag in code_tags:
        raw = code_tag.string or code_tag.get_text(strip=True)
        if not raw:
            continue
        raw = raw.strip()

        try:
            data = json.loads(raw)
        except Exception:
            continue

        included = []
        if isinstance(data, dict):
            if isinstance(data.get("included"), list):
                included.extend(data["included"])

            inner_data = data.get("data")
            if isinstance(inner_data, dict) and isinstance(inner_data.get("included"), list):
                included.extend(inner_data["included"])

        post_obj = None
        for obj in included:
            if not isinstance(obj, dict):
                continue
            if "commentary" in obj and "actor" in obj:
                post_obj = obj
                break

        if post_obj:
            actor = post_obj.get("actor") or {}
            if isinstance(actor, dict):
                name_block = actor.get("name") or {}
                name_text = name_block.get("text") or name_block.get("accessibilityText")
                if isinstance(name_text, str) and name_text.strip():
                    account_name = name_text.strip()

                sub_desc = actor.get("subDescription") or {}
                dt_text = sub_desc.get("accessibilityText") or sub_desc.get("text")
                if isinstance(dt_text, str) and dt_text.strip():
                    datetime_str = dt_text.strip()

            commentary = post_obj.get("commentary") or {}
            text_block = commentary.get("text") or {}
            text_val = text_block.get("text")
            if isinstance(text_val, str) and text_val.strip():
                post_text = text_val.strip()

        for obj in included:
            if not isinstance(obj, dict):
                continue

            otype = obj.get("$type", "")

            if account_name is None and "ActorComponent" in otype:
                name_block = obj.get("name") or {}
                name_text = name_block.get("text") or name_block.get("accessibilityText")
                sub_desc = obj.get("subDescription") or {}
                if isinstance(name_text, str) and name_text.strip() and sub_desc:
                    account_name = name_text.strip()

                    dt_text = sub_desc.get("accessibilityText") or sub_desc.get("text")
                    if isinstance(dt_text, str) and dt_text.strip() and not datetime_str:
                        datetime_str = dt_text.strip()

            if likes is None and otype.endswith(".SocialActivityCounts"):
                num_likes = obj.get("numLikes")
                if isinstance(num_likes, int):
                    likes = num_likes

            if post_text is None and "commentary" in obj:
                commentary = obj.get("commentary") or {}
                text_block = commentary.get("text") or {}
                text_val = text_block.get("text")
                if isinstance(text_val, str) and text_val.strip():
                    post_text = text_val.strip()

            if account_name is None and "firstName" in obj and "lastName" in obj:
                if "me" not in str(obj).lower() and "viewer" not in str(obj).lower():
                    first = str(obj.get("firstName") or "").strip()
                    last = str(obj.get("lastName") or "").strip()
                    full = f"{first} {last}".strip()
                    if full:
                        account_name = full

    return account_name, likes, datetime_str, post_text


def fetch_post_html(url: str, headers: Optional[Dict[str, str]] = None) -> str:
    """Load HTML of a LinkedIn post page."""
    if headers is None:
        headers = {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/123.0 Safari/537.36"
            )
        }
    resp = requests.get(url, headers=headers, timeout=30)
    if not resp.ok:
        raise LinkedInParserError(
            f"Не удалось загрузить страницу, статус: {resp.status_code}"
        )
    return resp.text


def parse_linkedin_post_from_html(url: str, html: str) -> LinkedInPost:
    """Parse LinkedIn post HTML and extract data."""
    soup = BeautifulSoup(html, "html.parser")

    json_account_name, json_likes, json_datetime, json_text = _extract_from_bootstrap_json(soup)

    account_name = json_account_name
    if not account_name:
        account_el = soup.find("meta", property="og:title")
        if account_el and account_el.get("content"):
            content = account_el["content"].strip()
            if "|" in content:
                possible_name = content.split("|")[-1].strip()
                account_name = html_lib.unescape(possible_name)
            else:
                account_name = html_lib.unescape(content)

    if not account_name:
        candidate = soup.find(["span", "a"], attrs={"class": lambda c: c and "feed-shared-actor__name" in c})
        if candidate and candidate.get_text(strip=True):
            account_name = candidate.get_text(strip=True)

    text = json_text
    if not text:
        desc_el = soup.find("meta", property="og:description")
        if desc_el and desc_el.get("content"):
            text = desc_el["content"].strip()

    if not text:
        text_block = soup.find(attrs={"class": lambda c: c and "feed-shared-update-v2__description" in c})
        if text_block:
            text = text_block.get_text(" ", strip=True)

    datetime_str = json_datetime
    if not datetime_str:
        time_el = soup.find("time")
        if time_el and time_el.get("datetime"):
            datetime_str = time_el["datetime"].strip()
        elif time_el and time_el.get_text(strip=True):
            datetime_str = time_el.get_text(strip=True)

    likes = json_likes
    if likes is None:
        likes_el = soup.find(attrs={"class": lambda c: c and "social-details-social-counts__reactions-count" in c})
        if likes_el:
            likes = _parse_int_safe(likes_el.get_text(strip=True))

    return LinkedInPost(
        url=url,
        account_name=account_name,
        text=text,
        likes=likes,
        datetime=datetime_str,
    )


def parse_linkedin_post(
    url: str,
    headers: Optional[Dict[str, str]] = None,
) -> LinkedInPost:
    """
    Высокоуровневая функция: качает страницу и парсит её.
    """
    html = fetch_post_html(url, headers=headers)
    return parse_linkedin_post_from_html(url, html)


def save_post_to_json(post: Union[LinkedInPost, VKPost], json_path: str = "posts.json") -> None:
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


def save_posts_to_json(posts: list, json_path: str = "posts.json") -> None:
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
                    likes=likes_count if likes_count else None,
                    comments=comments_count if comments_count else None,
                    reposts=reposts_count if reposts_count else None,
                    datetime=post_date_str,
                    views=views_count,
                    attachments=attachments,
                )
            )

        if not posts:
            raise VKParserError(f"VK API returned no posts for '{screen_name}'")

        print(f"Fetched {len(posts)} VK posts via API for '{screen_name}'.")
        return posts

    except requests.RequestException as e:
        raise VKParserError(f"VK API request failed for '{screen_name}': {e}")

