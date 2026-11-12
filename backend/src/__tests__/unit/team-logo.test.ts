// Логотип команды: тип по содержимому, пределы, перекодирование без метаданных.

import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { encodeLogo, LOGO_MAX_BYTES, LogoError, sniffLogoType } from "../../lib/team-logo.js";

const solid = (w: number, h: number) =>
  sharp({ create: { width: w, height: h, channels: 3, background: { r: 200, g: 40, b: 40 } } });

async function codeOf(run: Promise<unknown>): Promise<string> {
  try {
    await run;
    return "OK";
  } catch (error) {
    return error instanceof LogoError ? `${error.code}:${error.status}` : `OTHER:${String(error)}`;
  }
}

describe("тип файла по содержимому", () => {
  it("PNG, JPEG и WebP узнаются по первым байтам", async () => {
    expect(sniffLogoType(await solid(8, 8).png().toBuffer())).toBe("png");
    expect(sniffLogoType(await solid(8, 8).jpeg().toBuffer())).toBe("jpeg");
    expect(sniffLogoType(await solid(8, 8).webp().toBuffer())).toBe("webp");
  });
  it("SVG, GIF, HTML и пустой файл — не картинка", () => {
    expect(sniffLogoType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))).toBeNull();
    expect(sniffLogoType(Buffer.from("GIF89a\x01\x00\x01\x00", "latin1"))).toBeNull();
    expect(sniffLogoType(Buffer.from("<!doctype html><html></html>"))).toBeNull();
    expect(sniffLogoType(Buffer.alloc(0))).toBeNull();
  });
});

describe("перекодирование", () => {
  it("любой из трёх типов становится квадратом 256×256 WebP", async () => {
    for (const input of [await solid(640, 320).png().toBuffer(), await solid(100, 300).jpeg().toBuffer(), await solid(64, 64).webp().toBuffer()]) {
      const out = await encodeLogo(input);
      const meta = await sharp(out).metadata();
      expect([meta.format, meta.width, meta.height]).toEqual(["webp", 256, 256]);
      expect(out.length).toBeLessThan(262144);
    }
  });

  it("метаданные (EXIF с координатами) в результат не попадают", async () => {
    const input = await solid(300, 300)
      .withExif({ IFD0: { Copyright: "secret-owner", Artist: "secret-artist" }, IFD3: { GPSLatitudeRef: "N" } })
      .jpeg()
      .toBuffer();
    expect((await sharp(input).metadata()).exif).toBeDefined();
    const out = await encodeLogo(input);
    const meta = await sharp(out).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.icc).toBeUndefined();
    expect(meta.xmp).toBeUndefined();
    expect(out.includes(Buffer.from("secret-owner"))).toBe(false);
  });

  it("SVG под видом картинки и чужой тип — отказ 415", async () => {
    expect(await codeOf(encodeLogo(Buffer.from("<svg onload=alert(1)></svg>")))).toBe("LOGO_TYPE:415");
    expect(await codeOf(encodeLogo(Buffer.from("GIF89a\x01\x00\x01\x00\x80\x00\x00", "latin1")))).toBe("LOGO_TYPE:415");
  });

  it("заголовок PNG и мусор внутри — отказ, не падение", async () => {
    const fake = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("<script>alert(1)</script>".repeat(50))]);
    expect(await codeOf(encodeLogo(fake))).toBe("LOGO_BAD_IMAGE:400");
  });

  it("обрезанный файл — отказ", async () => {
    const png = await solid(400, 400).png().toBuffer();
    expect(await codeOf(encodeLogo(png.subarray(0, Math.floor(png.length / 2))))).toBe("LOGO_BAD_IMAGE:400");
  });

  it("пустой файл и файл больше 2 МБ — отказ до разбора", async () => {
    expect(await codeOf(encodeLogo(Buffer.alloc(0)))).toBe("LOGO_EMPTY:400");
    const big = Buffer.concat([await solid(8, 8).png().toBuffer(), Buffer.alloc(LOGO_MAX_BYTES)]);
    expect(await codeOf(encodeLogo(big))).toBe("LOGO_TOO_LARGE:413");
  });

  it("маленький файл с огромным числом пикселей — отказ", async () => {
    // Одноцветный PNG 6000×6000 весит десятки килобайт, а в памяти — 100+ МБ.
    const bomb = await solid(6000, 6000).png({ compressionLevel: 9 }).toBuffer();
    expect(bomb.length).toBeLessThan(LOGO_MAX_BYTES);
    expect(await codeOf(encodeLogo(bomb))).toBe("LOGO_BAD_IMAGE:400");
  }, 30_000);
});
