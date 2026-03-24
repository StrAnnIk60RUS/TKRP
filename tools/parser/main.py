import os

from parser import (
    LinkedInParserError,
    LinkedInPost,
    VKParserError,
    parse_linkedin_post,
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
    url = input("Enter LinkedIn post URL or VK account URL: ").strip()
    if not url:
        print("Empty URL. Exit.")
        return

    is_vk = "vk.com" in url.lower()
    is_linkedin = "linkedin.com" in url.lower()
    output_path = os.getenv("PARSER_OUTPUT_PATH", "posts.json")
    vk_cookie = os.getenv("VK_COOKIE", "").strip()
    linkedin_cookie = os.getenv("LINKEDIN_COOKIE", "").strip()

    if is_vk:
        headers = _build_browser_headers(vk_cookie)
        try:
            print("Parsing posts from VK account...")
            if vk_cookie:
                print("Using VK cookies from environment...")
            posts = parse_vk_account(url, headers=headers)

            if not posts:
                print("\nNo posts found.")
                print("Possible reasons:")
                print("1. Cookies are outdated – refresh them from the browser")
                print("2. VK requires JavaScript to load posts")
                print("3. Check vk_debug.html – it contains saved page HTML")
                print("\nTry:")
                print("- Update cookies from browser DevTools")
                print("- Set VK_COOKIE in environment before running parser")
                return

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
        except VKParserError as exc:
            print(f"VK parsing error: {exc}")
            return

    elif is_linkedin:
        headers = _build_browser_headers(linkedin_cookie)

        try:
            post: LinkedInPost = parse_linkedin_post(url, headers=headers)
        except LinkedInParserError as exc:
            print(f"LinkedIn parsing error: {exc}")
            return

        save_post_to_json(post, json_path=output_path)

        print(f"Post parsed and saved to '{output_path}':")
        print(f"- URL: {post.url}")
        print(f"- Account: {post.account_name}")
        print(f"- Likes: {post.likes}")
        print(f"- Datetime: {post.datetime}")
        print(f"- Text: {_ascii_preview(post.text, max_len=120)}")

    else:
        print("Unsupported URL. Only LinkedIn and VK are supported.")


if __name__ == "__main__":
    main()
