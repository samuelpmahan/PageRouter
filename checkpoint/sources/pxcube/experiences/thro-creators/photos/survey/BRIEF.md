# Manufacturer disc photos for thro (one group of brands)

thro.dev shows each disc as a ThroCard. We need, for every mold in your task file, ONE default photo published by the disc's
MANUFACTURER (the brand's own website/store), so a card can show the real disc even when the creator has no shop.

Your task file: /home/claude/mfr/tasks/GROUP.json  (brands -> molds with disc_id, mold name, flight numbers)
Your output:    /home/claude/mfr/out/GROUP.jsonl  (one JSON object per line, one line per disc_id — every disc_id in the task, even when not found)

Line format (exact keys):
{"disc_id":"discraft/buzzz","mold":"Buzzz","maker":"Discraft","provider":"manufacturer","source_site":"discraft.com",
 "product_page":"https://…","image_url":"https://…","image_check":"200 image/jpeg 183422","match":"exact|stock|special-edition|none",
 "confidence":"high|medium|low","note":"short reason"}
- match "exact": the product page is this mold (any standard plastic); "stock": a generic/stock photo of the mold;
  "special-edition": only a signature/limited run exists (prefer a plain one if any exists); "none": not found (image_url "").
- Prefer: the manufacturer's own site. A plain top-down photo of a standard run of the mold. Not a box, bag, bundle, starter set,
  mini, or a different mold with a similar name (e.g. "Buzzz SS" is not "Buzzz", "Firebird" is not "FireBird L").
- Never use retailer sites (Infinite Discs is a manufacturer only for its own molds), marketplaces, Pinterest, or image search thumbnails.
  If the manufacturer has no site or no photo of the mold, write match "none" with a note (e.g. "maker site has no product pages").
- Every image_url must pass: python3 /home/claude/mfr/mfr-tool.py check URL  -> "200 image/…". Put that output in image_check.

Tools (no installs needed):
- Shopify stores (most brands): python3 /home/claude/mfr/mfr-tool.py shopify www.brand.com > /tmp/GROUP-brand.tsv  (all products: title, handle, url, first image)
  then match molds against titles with grep -i. Quick lookup: python3 /home/claude/mfr/mfr-tool.py search www.brand.com "Buzzz"
- Any page: python3 /home/claude/mfr/mfr-tool.py og URL  (prints og:image and large <img> URLs); curl -sL works for most sites.
- WebSearch to find the official site or a product page ("<brand> <mold> disc golf site:brand.com").
Work brand by brand: find the official site first, dump its catalog once, then match every mold. Keep notes short.
Do not write anywhere except your output file and /tmp. Do not post, buy, sign in or fill forms.
When done, reply with: counts by match (exact/stock/special-edition/none), the official site you used per brand, and anything odd.
