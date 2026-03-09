import json
import re
import os
import html as html_lib
from dataclasses import dataclass, asdict
from datetime import datetime, timedelta
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


def _parse_relative_date(date_str: str) -> Optional[str]:
    """Convert VK relative date (e.g. '5 д назад') into concrete timestamp."""
    if not date_str:
        return None
    
    original_date_str = date_str.strip()
    date_str = original_date_str.lower()
    now = datetime.now()
    
    patterns = [
        (r'(\d+)\s*сек\s*назад', lambda m: now - timedelta(seconds=int(m.group(1)))),
        (r'(\d+)\s*мин\s*назад', lambda m: now - timedelta(minutes=int(m.group(1)))),
        (r'(\d+)\s*ч\s*назад', lambda m: now - timedelta(hours=int(m.group(1)))),
        (r'(\d+)\s*д\s*назад', lambda m: now - timedelta(days=int(m.group(1)))),
        (r'(\d+)\s*дн\s*назад', lambda m: now - timedelta(days=int(m.group(1)))),
        (r'(\d+)\s*нед\s*назад', lambda m: now - timedelta(weeks=int(m.group(1)))),
        (r'(\d+)\s*мес\s*назад', lambda m: now - timedelta(days=int(m.group(1)) * 30)),
        (r'(\d+)\s*год\s*назад', lambda m: now - timedelta(days=int(m.group(1)) * 365)),
        (r'вчера', lambda m: now - timedelta(days=1)),
        (r'сегодня', lambda m: now),
    ]
    
    for pattern, func in patterns:
        match = re.search(pattern, date_str)
        if match:
            try:
                dt = func(match)
                return dt.strftime("%Y-%m-%d %H:%M:%S")
            except:
                continue
    
    month_map = {
        'янв': 1, 'фев': 2, 'мар': 3, 'апр': 4, 'май': 5, 'июн': 6,
        'июл': 7, 'авг': 8, 'сен': 9, 'окт': 10, 'ноя': 11, 'дек': 12
    }
    
    match = re.match(r'(\d+)\s+([а-яё]+)(?:\s+(\d+))?', date_str)
    if match:
        try:
            day = int(match.group(1))
            month_name = match.group(2)
            year = int(match.group(3)) if match.group(3) else now.year
            
            for month_key, month_num in month_map.items():
                if month_name.startswith(month_key):
                    dt = datetime(year, month_num, day)
                    if dt > now:
                        dt = datetime(year - 1, month_num, day)
                    return dt.strftime("%Y-%m-%d %H:%M:%S")
        except:
            pass
    
    try:
        dt = datetime.strptime(original_date_str, "%d %b %Y")
        return dt.strftime("%Y-%m-%d %H:%M:%S")
    except:
        pass
    
    try:
        dt = datetime.strptime(original_date_str, "%d.%m.%Y")
        return dt.strftime("%Y-%m-%d %H:%M:%S")
    except:
        pass
    
    try:
        dt = datetime.strptime(original_date_str, "%d %B %Y")
        return dt.strftime("%Y-%m-%d %H:%M:%S")
    except:
        pass
    
    return None


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


def fetch_vk_page_html(url: str, headers: Optional[Dict[str, str]] = None) -> str:
    """Load HTML of VK page."""
    if headers is None:
        headers = {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/123.0 Safari/537.36"
            )
        }
    
    if not url.startswith("http"):
        url = "https://" + url
    
    if "vk.com" not in url:
        raise VKParserError("Некорректная ссылка на ВКонтакте")
    
    resp = requests.get(url, headers=headers, timeout=30)
    if not resp.ok:
        raise VKParserError(
            f"Не удалось загрузить страницу, статус: {resp.status_code}"
        )
    return resp.text


def parse_vk_post_element(post_elem, account_name: str, base_url: str) -> Optional[VKPost]:
    """Parse a single VK post element from HTML."""
    try:
        post_id_attr = post_elem.get("data-post-id", "")
        if not post_id_attr:
            post_id_attr = post_elem.get("id", "")
        
        if not post_id_attr or "post" not in str(post_id_attr).lower():
            if post_elem.get("data-testid") != "post":
                return None
        
        text = None
        content_container = post_elem.find("div", attrs={"data-testid": "post-content-container"})
        if content_container:
            skip_words = ["лайк", "комментар", "поделит", "like", "comment", "share", "действия", "actions", "отправить реакцию", "выбор реакции", "реакцию"]
            all_text_parts = []
            for elem in content_container.find_all(["div", "p", "span"]):
                elem_text = elem.get_text(strip=True)
                if elem_text and len(elem_text) > 10:
                    elem_lower = elem_text.lower()
                    if not any(skip in elem_lower for skip in skip_words):
                        if len(elem_text) > 20 or (len(elem_text) > 10 and not elem_text.replace(" ", "").isdigit()):
                            if elem_text not in all_text_parts:
                                all_text_parts.append(elem_text)
            if all_text_parts:
                text = " ".join(all_text_parts).strip()
        
        if not text or len(text) < 10:
            text_elem = post_elem.find("div", class_=re.compile(r"wall_post_text|post_text|PostText"))
            if text_elem:
                text = text_elem.get_text(separator=" ", strip=True)
        
        if not text or len(text) < 10:
            all_text_divs = post_elem.find_all(["div", "p"])
            for div in all_text_divs:
                div_text = div.get_text(strip=True)
                if div_text and len(div_text) > 20 and len(div_text) < 5000:
                    div_lower = div_text.lower()
                    if not any(skip in div_lower for skip in ["лайк", "комментар", "поделит", "like", "comment", "share", "действия", "actions", "отправить реакцию", "выбор реакции"]):
                        if not div_text.replace(" ", "").isdigit():
                            text = div_text
                            break
        
        likes = None
        like_reaction = post_elem.find("div", class_=re.compile(r"PostButtonReactions"))
        if like_reaction:
            data_counts = like_reaction.get("data-reaction-counts", "")
            if data_counts:
                try:
                    counts = json.loads(data_counts)
                    if isinstance(counts, list) and len(counts) > 0:
                        likes = int(counts[0])
                except:
                    pass
            
            if likes is None:
                like_title = like_reaction.find("div", class_=re.compile(r"PostButtonReactions__title"))
                if like_title:
                    likes_text = like_title.get_text(strip=True)
                    likes = _parse_int_safe(likes_text)
            
            if likes is None:
                aria_label = like_reaction.get("aria-label", "")
                if aria_label:
                    match = re.search(r'(\d+)', aria_label)
                    if match:
                        likes = int(match.group(1))
        
        if likes is None:
            like_title = post_elem.find("div", class_=re.compile(r"PostButtonReactions__title"))
            if like_title:
                likes_text = like_title.get_text(strip=True)
                likes = _parse_int_safe(likes_text)
        
        if likes is None:
            like_action = post_elem.find("div", attrs={"data-testid": "post_footer_action_like"})
            if like_action:
                all_footnote_spans = like_action.find_all("span", class_=lambda c: c and "vkuiFootnote__host" in " ".join(c) if isinstance(c, list) else "vkuiFootnote__host" in str(c))
                for span in all_footnote_spans:
                    span_text = span.get_text(strip=True)
                    if span_text:
                        likes = _parse_int_safe(span_text)
                        if likes is not None:
                            break
                
                if likes is None:
                    all_spans = like_action.find_all("span", class_=re.compile(r"vkuiFootnote"))
                    for span in all_spans:
                        span_text = span.get_text(strip=True)
                        if span_text and span_text.strip().isdigit():
                            likes = int(span_text.strip())
                            break
        
        if likes is None:
            like_icon = post_elem.find("svg", class_=re.compile(r"like"))
            if like_icon:
                parent = like_icon.find_parent()
                if parent:
                    all_footnote_spans = parent.find_all("span", class_=lambda c: c and "vkuiFootnote__host" in " ".join(c) if isinstance(c, list) else "vkuiFootnote__host" in str(c))
                    for span in all_footnote_spans:
                        span_text = span.get_text(strip=True)
                        if span_text:
                            likes = _parse_int_safe(span_text)
                            if likes is not None:
                                break
                    if likes is None:
                        all_spans = parent.find_all("span", class_=re.compile(r"vkuiFootnote"))
                        for span in all_spans:
                            span_text = span.get_text(strip=True)
                            if span_text and span_text.strip().isdigit():
                                likes = int(span_text.strip())
                                break
        
        comments = None
        replies_wrap = post_elem.find("div", class_=re.compile(r"replies_wrap|replies_list"))
        if replies_wrap:
            replies_count_elem = replies_wrap.find("div", class_=re.compile(r"replies_count|count"))
            if replies_count_elem:
                comments_text = replies_count_elem.get_text(strip=True)
                comments = _parse_int_safe(comments_text)
        
        if comments is None:
            replies_elem = post_elem.find("div", class_=re.compile(r"replies"))
            if replies_elem:
                replies_count_attr = replies_elem.get("data-count", "")
                if replies_count_attr:
                    comments = _parse_int_safe(replies_count_attr)
                else:
                    all_spans = replies_elem.find_all("span", class_=re.compile(r"count|replies"))
                    for span in all_spans:
                        span_text = span.get_text(strip=True)
                        if span_text and span_text.strip().isdigit():
                            comments = int(span_text.strip())
                            break
        
        if comments is None:
            comment_action = post_elem.find("div", attrs={"data-testid": "post_footer_action_comment"})
            if comment_action:
                all_footnote_spans = comment_action.find_all("span", class_=lambda c: c and "vkuiFootnote__host" in " ".join(c) if isinstance(c, list) else "vkuiFootnote__host" in str(c))
                for span in all_footnote_spans:
                    span_text = span.get_text(strip=True)
                    if span_text:
                        comments = _parse_int_safe(span_text)
                        if comments is not None:
                            break
                
                if comments is None:
                    all_spans = comment_action.find_all("span", class_=re.compile(r"vkuiFootnote"))
                    for span in all_spans:
                        span_text = span.get_text(strip=True)
                        if span_text and span_text.strip().isdigit():
                            comments = int(span_text.strip())
                            break
        
        if comments is None:
            comment_icon = post_elem.find("svg", class_=re.compile(r"comment"))
            if comment_icon:
                parent = comment_icon.find_parent()
                if parent:
                    all_footnote_spans = parent.find_all("span", class_=lambda c: c and "vkuiFootnote__host" in " ".join(c) if isinstance(c, list) else "vkuiFootnote__host" in str(c))
                    for span in all_footnote_spans:
                        span_text = span.get_text(strip=True)
                        if span_text:
                            comments = _parse_int_safe(span_text)
                            if comments is not None:
                                break
                    if comments is None:
                        all_spans = parent.find_all("span", class_=re.compile(r"vkuiFootnote"))
                        for span in all_spans:
                            span_text = span.get_text(strip=True)
                            if span_text and span_text.strip().isdigit():
                                comments = int(span_text.strip())
                                break
        
        reposts = None
        share_action_elem = post_elem.find("div", class_=re.compile(r"share.*PostBottomAction|PostBottomAction.*share"))
        if share_action_elem:
            data_count = share_action_elem.get("data-count", "")
            if data_count:
                reposts = _parse_int_safe(data_count)
            
            if reposts is None:
                count_elem = share_action_elem.find("span", class_=re.compile(r"PostBottomAction__count|_like_button_count"))
                if count_elem:
                    reposts_text = count_elem.get_text(strip=True)
                    reposts = _parse_int_safe(reposts_text)
            
            if reposts is None:
                aria_label = share_action_elem.get("aria-label", "")
                if aria_label:
                    match = re.search(r'(\d+)', aria_label)
                    if match:
                        reposts = int(match.group(1))
        
        if reposts is None:
            share_count = post_elem.find("span", class_=re.compile(r"PostBottomAction__count.*share|share.*PostBottomAction__count"))
            if share_count:
                reposts_text = share_count.get_text(strip=True)
                reposts = _parse_int_safe(reposts_text)
        
        if reposts is None:
            share_action = post_elem.find("div", attrs={"data-testid": "post_footer_action_share"})
            if share_action:
                all_footnote_spans = share_action.find_all("span", class_=lambda c: c and "vkuiFootnote__host" in " ".join(c) if isinstance(c, list) else "vkuiFootnote__host" in str(c))
                for span in all_footnote_spans:
                    span_text = span.get_text(strip=True)
                    if span_text:
                        reposts = _parse_int_safe(span_text)
                        if reposts is not None:
                            break
                
                if reposts is None:
                    all_spans = share_action.find_all("span", class_=re.compile(r"vkuiFootnote"))
                    for span in all_spans:
                        span_text = span.get_text(strip=True)
                        if span_text and span_text.strip().isdigit():
                            reposts = int(span_text.strip())
                            break
        
        if reposts is None:
            share_icon = post_elem.find("svg", class_=re.compile(r"share"))
            if share_icon:
                parent = share_icon.find_parent()
                if parent:
                    all_footnote_spans = parent.find_all("span", class_=lambda c: c and "vkuiFootnote__host" in " ".join(c) if isinstance(c, list) else "vkuiFootnote__host" in str(c))
                    for span in all_footnote_spans:
                        span_text = span.get_text(strip=True)
                        if span_text:
                            reposts = _parse_int_safe(span_text)
                            if reposts is not None:
                                break
                    if reposts is None:
                        all_spans = parent.find_all("span", class_=re.compile(r"vkuiFootnote"))
                        for span in all_spans:
                            span_text = span.get_text(strip=True)
                            if span_text and span_text.strip().isdigit():
                                reposts = int(span_text.strip())
                                break
        
        if likes is None or comments is None or reposts is None:
            footer_row = post_elem.find("div", class_=re.compile(r"PostFooterRow|post_footer|footer"))
            if footer_row:
                all_footnote_spans = footer_row.find_all("span", class_=lambda c: c and "vkuiFootnote__host" in " ".join(c) if isinstance(c, list) else "vkuiFootnote__host" in str(c))
                for span in all_footnote_spans:
                    span_text = span.get_text(strip=True)
                    if span_text:
                        num = _parse_int_safe(span_text)
                        if num is not None:
                            parent_action = span.find_parent("div", attrs={"data-testid": re.compile(r"post_footer_action")})
                            if parent_action:
                                testid = parent_action.get("data-testid", "")
                                if "like" in testid and likes is None:
                                    likes = num
                                elif "comment" in testid and comments is None:
                                    comments = num
                                elif "share" in testid and reposts is None:
                                    reposts = num
        
        if likes is None or comments is None or reposts is None:
            all_footnote_in_post = post_elem.find_all("span", class_=lambda c: c and "vkuiFootnote__host" in " ".join(c) if isinstance(c, list) else "vkuiFootnote__host" in str(c))
            for span in all_footnote_in_post:
                span_text = span.get_text(strip=True)
                if span_text:
                    num = _parse_int_safe(span_text)
                    if num is not None:
                        parent = span.find_parent()
                        if parent:
                            parent_action = parent.find_parent("div", attrs={"data-testid": re.compile(r"post_footer_action")})
                            if parent_action:
                                testid = parent_action.get("data-testid", "")
                                if "like" in testid and likes is None:
                                    likes = num
                                elif "comment" in testid and comments is None:
                                    comments = num
                                elif "share" in testid and reposts is None:
                                    reposts = num
        
        datetime_str = None
        post_url = base_url
        
        post_id_attr = post_elem.get("data-post-id", "")
        if post_id_attr and "_" in post_id_attr:
            try:
                parts = post_id_attr.split("_")
                if len(parts) >= 2:
                    timestamp_match = re.search(r'(\d{10})', parts[-1])
                    if timestamp_match:
                        timestamp = int(timestamp_match.group(1))
                        dt = datetime.fromtimestamp(timestamp)
                        datetime_str = dt.strftime("%Y-%m-%d %H:%M:%S")
            except:
                pass
        
        if not datetime_str:
            date_link = post_elem.find("a", attrs={"data-testid": "post_date_block_preview"})
            if date_link:
                date_text = date_link.get_text(strip=True)
                href = date_link.get("href", "")
                if href:
                    post_url = "https://vk.com" + href if href.startswith("/") else href
                
                datetime_str = _parse_relative_date(date_text)
                if not datetime_str:
                    datetime_str = date_text
        
        if not datetime_str:
            time_elem = post_elem.find("time")
            if time_elem:
                datetime_attr = time_elem.get("datetime")
                if datetime_attr:
                    try:
                        dt = datetime.fromisoformat(datetime_attr.replace("Z", "+00:00"))
                        datetime_str = dt.strftime("%Y-%m-%d %H:%M:%S")
                    except:
                        date_text = time_elem.get_text(strip=True)
                        datetime_str = _parse_relative_date(date_text) or date_text
                else:
                    date_text = time_elem.get_text(strip=True)
                    datetime_str = _parse_relative_date(date_text) or date_text
        
        if not datetime_str:
            date_elem = post_elem.find("a", href=re.compile(r"wall"))
            if date_elem:
                date_text = date_elem.get_text(strip=True)
                datetime_str = _parse_relative_date(date_text) or date_text
                href = date_elem.get("href", "")
                if href:
                    post_url = "https://vk.com" + href if href.startswith("/") else href
        
        if not account_name or account_name == "Unknown":
            title_link = post_elem.find("a", attrs={"data-testid": "post-header-title"})
            if title_link:
                account_name = title_link.get_text(strip=True) or title_link.get("title", "")
        
        if not text:
            return None
        
        return VKPost(
            url=post_url,
            account_name=account_name,
            text=text,
            likes=likes,
            comments=comments,
            reposts=reposts,
            datetime=datetime_str,
        )
    except Exception as e:
        return None


def _extract_vk_data_from_scripts(soup: BeautifulSoup) -> Tuple[Optional[str], List[Dict[str, Any]]]:
    """Extract VK posts data from inline JSON inside scripts."""
    account_name = None
    posts_data = []
    
    html_text = str(soup)
    
    patterns = [
        (r'window\.__initial(?:Data|State)\s*=\s*({.+?});', True),
        (r'(?:var\s+)?pageData\s*=\s*({.+?});', True),
        (r'window\.pageData\s*=\s*({.+?});', True),
        (r'var\s+page\s*=\s*({.+?});', True),
        (r'"wall":\s*\{[^}]*"items":\s*\[(.*?)\]', False),
        (r'\{[^{}]*"wall"[^{}]*\{[^{}]*"items"[^{}]*\[(.*?)\][^{}]*\}', False),
    ]
    
    for pattern, is_full_json in patterns:
        matches = re.finditer(pattern, html_text, re.DOTALL)
        for match in matches:
            try:
                if is_full_json:
                    data = json.loads(match.group(1))
                    if isinstance(data, dict):
                        if "profile" in data:
                            profile = data["profile"]
                            if isinstance(profile, dict):
                                account_name = profile.get("name") or profile.get("title") or account_name
                        if "group" in data:
                            group = data["group"]
                            if isinstance(group, dict):
                                account_name = group.get("name") or group.get("title") or account_name
                        if "wall" in data:
                            wall = data["wall"]
                            if isinstance(wall, dict) and "items" in wall:
                                if isinstance(wall["items"], list):
                                    posts_data.extend(wall["items"])
                        if "items" in data and isinstance(data["items"], list):
                            for item in data["items"]:
                                if isinstance(item, dict) and ("text" in item or "post_id" in item or "id" in item):
                                    posts_data.append(item)
                else:
                    items_text = match.group(1) if match.lastindex else match.group(0)
                    items_match = re.search(r'\[(.*?)\]', items_text, re.DOTALL)
                    if items_match:
                        items_str = "[" + items_match.group(1) + "]"
                        items = json.loads(items_str)
                        if isinstance(items, list):
                            posts_data.extend(items)
            except Exception:
                continue
    
    script_tags = soup.find_all("script")
    
    for script in script_tags:
        script_text = script.string or script.get_text()
        if not script_text or len(script_text) < 100:
            continue
        
        try:
            if '"text"' in script_text and ('"date"' in script_text or '"id"' in script_text):
                json_objects = re.finditer(r'\{[^{}]*"text"[^{}]*"date"[^{}]*\}', script_text, re.DOTALL)
                for match in json_objects:
                    try:
                        obj = json.loads(match.group())
                        if isinstance(obj, dict) and "text" in obj:
                            posts_data.append(obj)
                    except:
                        continue
            
            if "vk.com" in script_text and "wall" in script_text:
                large_json = re.search(r'\{.*?"wall".*?"items".*?\[.*?\]', script_text, re.DOTALL)
                if large_json:
                    try:
                        full_json = re.search(r'\{.*\}', large_json.group(), re.DOTALL)
                        if full_json:
                            data = json.loads(full_json.group())
                            if isinstance(data, dict):
                                if "wall" in data and "items" in data["wall"]:
                                    posts_data.extend(data["wall"]["items"])
                    except:
                        pass
        except Exception:
            continue
    
    return account_name, posts_data


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

