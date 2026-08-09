# After reading @trq212's tweet, I switched all of my Markdown to HTML

> Original tweet: https://x.com/trq212/status/2052809885763747935
>
> In short: in the AI writing / editor / agent era, Markdown — this "intermediate state" — can no longer hold up. HTML is the final form meant for readers.

## Three observations that made me nod

First, our love of Markdown is mostly about how nice it is to write. But readers never voted.
Readers always get whatever a Markdown renderer produced — and that renderer belongs to the platform, not to you.

Second, Markdown loses when you screenshot it into a tweet.
Pick any piece of Markdown and screenshot it: it comes out as a flat grey block crushed by GitHub's default theme. HTML can be wallpaper-grade imagery.

Third, WeChat / Zhihu / Xiaohongshu / Notion / Feishu — every one of them interprets Markdown differently.
Write it once and you have to adjust it 5 times for 5 platforms. HTML + inline CSS: one paste, reproduced identically on any platform.

## But HTML is verbose, that's true

Writing `<div class="...">` over and over makes you queasy, that's a fact.
Nobody used to be willing to pay the cost of writing HTML, because for the same content: Markdown 30 seconds, HTML 30 minutes.

The variable is — **AI has brought those 30 minutes down to 30 seconds**.
You write Markdown, AI upgrades it into shippable HTML. You own the final form, AI handles the verbose details.

## We built a tool along the way

Inspired by the original tweet, plus the Claude Code team's practice, we built [HTML Anything](https://github.com/nexu-io/html-anything).
Paste Markdown / CSV / JSON on the left, pick a template (magazine, deck, poster, Xiaohongshu, data report …), hit ⌘+Enter —
your local Claude / Cursor / Codex runs in your **already logged-in** session, and seconds later the right side holds HTML you can copy straight into WeChat / Twitter / Zhihu.

No API key needed, no tokens wasted (re-edits only run a diff).

## Conclusion

If you too feel that "markdown → manually reflowing it in an editor" is wasting your life — look at the original tweet, look at the Claude Code team's migration, then try any tool that can automatically upgrade Markdown to HTML.

> Header image tribute: that "everything is HTML" moment from the tweet.
