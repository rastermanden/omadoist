/**
 * Bake the Todoist mark into a one-glyph TTF.
 *
 * The Omarchy menu draws an extension row's icon as *text* — image icons are
 * reserved for rows the shell builds from desktop entries — so the only way to
 * show a real logo is to hand it a font that contains one. `iconFont` on the
 * row picks this family up.
 *
 * Run with `bun run build:font` after changing the SVG; the TTF is committed so
 * installing omadoist needs no font toolchain.
 */
import { Readable } from "node:stream"
import { SVGIcons2SVGFontStream } from "svgicons2svgfont"
import svg2ttf from "svg2ttf"

const ROOT = new URL("..", import.meta.url).pathname
const SOURCE = ROOT + "assets/todoist.svg"
const TARGET = ROOT + "assets/omadoist-icons.ttf"

export const FONT_FAMILY = "Omadoist Icons"
export const GLYPH = "\u{E900}"

const UNITS_PER_EM = 1000
const DESCENT = 200

/**
 * Share of the em square the mark fills. Nerd Font glyphs sit a little inside
 * their em box, so a full-bleed logo next to them reads as oversized; the icons
 * are normalized to fill the canvas, so padding the canvas shrinks the mark.
 */
const ICON_SCALE = 0.86

/** Widen the 24×24 viewBox and re-centre the mark inside it. */
function padded(svg: string): string {
  const box = 24 / ICON_SCALE
  const offset = (box - 24) / 2
  const path = svg.match(/<path[^>]*\bd="([^"]+)"/)?.[1]
  if (!path) throw new Error(`no <path d="…"> in ${SOURCE}`)
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${box} ${box}">`,
    `<g transform="translate(${offset} ${offset})"><path d="${path}"/></g>`,
    `</svg>`,
  ].join("")
}

function svgFont(icon: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stream = new SVGIcons2SVGFontStream({
      fontName: FONT_FAMILY,
      fontHeight: UNITS_PER_EM,
      descent: DESCENT,
      normalize: true,
      centerHorizontally: true,
      log: () => {},
    })

    let out = ""
    stream.on("data", (chunk: Buffer) => (out += chunk.toString()))
    stream.on("finish", () => resolve(out))
    stream.on("error", reject)

    const glyph = Object.assign(Readable.from([icon]), {
      metadata: { name: "todoist", unicode: [GLYPH] },
    })
    stream.write(glyph)
    stream.end()
  })
}

const source = await Bun.file(SOURCE).text()
// A fixed timestamp keeps rebuilds byte-identical, so the committed TTF only
// changes when the artwork does.
const ttf = svg2ttf(await svgFont(padded(source)), { ts: 0 })
await Bun.write(TARGET, Buffer.from(ttf.buffer))

console.log(`wrote ${TARGET} (${Buffer.from(ttf.buffer).length} bytes)`)
