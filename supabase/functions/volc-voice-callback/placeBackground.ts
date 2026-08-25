/** 地名/景点背景检索（国内可达：搜狗网页摘要；补奇闻逸事） */

type LoreHit = {
  title: string
  extract: string
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&ensp;/g, ' ')
    .replace(/&emsp;/g, ' ')
    .replace(/&#\d+;/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function parseSogouHtml(html: string): LoreHit[] {
  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
  const blocks = cleaned.split(/<div class="vrwrap"/i).slice(1, 20)
  const hits: LoreHit[] = []
  for (const block of blocks) {
    const titleM = block.match(/<h3[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i)
    if (!titleM) continue
    const title = stripTags(titleM[1])
    if (!title || title.length < 2) continue

    let extract = ''
    const snipPats = [
      /class="star-wiki[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/i,
      /class="[^"]*str-text[^"]*"[^>]*>([\s\S]*?)<\/(?:p|div|span)>/i,
      /class="[^"]*space-txt[^"]*"[^>]*>([\s\S]*?)<\/(?:p|div|span)>/i,
    ]
    for (const pat of snipPats) {
      const m = block.match(pat)
      if (!m) continue
      const text = stripTags(m[1])
      if (text.length > 40) {
        extract = text.slice(0, 280)
        break
      }
    }
    if (!extract) continue
    hits.push({ title: title.slice(0, 80), extract })
    if (hits.length >= 4) break
  }
  return hits
}

async function sogouSearch(query: string): Promise<LoreHit[]> {
  const q = `${query} 历史 典故 传说`
  const url =
    'https://www.sogou.com/web?' +
    new URLSearchParams({ query: q }).toString()
  const res = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'zh-CN,zh;q=0.9',
    },
  })
  if (!res.ok) {
    throw new Error(`sogou_http_${res.status}`)
  }
  const html = await res.text()
  return parseSogouHtml(html)
}

export async function searchPlaceBackground(queryRaw: string): Promise<Record<string, unknown>> {
  const query = queryRaw.trim().slice(0, 60)
  if (!query) {
    return {
      ok: false,
      error: 'empty_query',
      reply_hint: '没有可查的专名；请按已有知识简短回答，不要编造典故。',
    }
  }

  try {
    const hits = await sogouSearch(query)
    if (hits.length === 0) {
      return {
        ok: false,
        query,
        hits: [],
        reply_hint:
          '暂时没查到可靠背景。请用自身知识谨慎回答；没有把握就不要编造奇闻逸事。',
      }
    }

    return {
      ok: true,
      query,
      source: 'web_snippets',
      hits,
      reply_hint:
        '把有趣、可靠的点融进口语讲解；能贯古通今更好，但不要念网址、不要说「根据搜索」。' +
        '与当前地标无关或像广告软文的忽略。没有把握的细节不要说成定论。',
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return {
      ok: false,
      query,
      error: msg,
      reply_hint: '背景检索失败；请用自身知识简短回答，不要编造典故。',
    }
  }
}
