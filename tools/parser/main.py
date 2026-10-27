import os

from parser import (
    InstagramParserError,
    VKParserError,
    parse_instagram_account,
    parse_vk_account,
    save_post_to_json,
    save_posts_to_json,
)


def _ascii_preview(text: str, max_len: int = 100) -> str:
    """
    Return ASCII-only preview of text to avoid Windows console encoding issues.
    Emojis and non-ASCII chars are replaced with '?'.
    """
    if not text:
        return ""
    preview = text[:max_len] + "..." if len(text) > max_len else text
    return "".join(ch if ord(ch) < 128 else "?" for ch in preview)


def _build_browser_headers(cookie_value: str = "") -> dict:
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
            "AppleWebKit/537.36 (KHTML, like Gecko)"
            "Chrome/145.0.0.0 Safari/537.36"
        )
    }
    if cookie_value:
        headers["Cookie"] = cookie_value
    return headers


def main() -> None:
    """
    Simple CLI entrypoint for the parser.
    """
    url = input("Enter account URL: ").strip()
    if not url:
        print("Empty URL. Exit.")
        return

    output_path = os.getenv("PARSER_OUTPUT_PATH", "posts.json")

    lowered = url.lower()
    is_instagram = "instagram.com" in lowered or "instagr.am" in lowered
    is_vk = "vk.com" in lowered or "vkontakte.ru" in lowered
    is_linkedin = "linkedin.com" in lowered

    try:
        if is_instagram:
            print("Parsing posts from Instagram account...")
            posts = parse_instagram_account(url)
        elif is_vk:
            print("Parsing posts from VK account...")
            posts = parse_vk_account(url)
        elif is_linkedin:
            print("LinkedIn parsing via direct CLI is not supported.")
            raise SystemExit(1)
        else:
            print(f"Unsupported platform URL: {url}")
            raise SystemExit(1)

        save_posts_to_json(posts, json_path=output_path)

        print(f"\nFound posts: {len(posts)}")
        print(f"Account: {posts[0].account_name if posts else 'Unknown'}")
        print("\nFirst few posts:")
        for i, post in enumerate(posts[:5], 1):
            print(f"\n{i}. URL: {post.url}")
            print(f"   Likes: {post.likes}")
            print(f"   Comments: {post.comments}")
            print(f"   Reposts: {post.reposts}")
            print(f"   Datetime: {post.datetime}")
            print(f"   Text: {_ascii_preview(post.text)}")

        if len(posts) > 5:
            print(f"\n... and {len(posts) - 5} more posts")

        print(f"\nAll posts saved to '{output_path}'")
    except InstagramParserError as exc:
        print(f"Instagram parsing error: {exc}")
        raise SystemExit(1)
    except VKParserError as exc:
        print(f"VK parsing error: {exc}")
        raise SystemExit(1)


if __name__ == "__main__":
    main()
