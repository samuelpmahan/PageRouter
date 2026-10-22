# DiscStudio cards in thro

The fifteen files listed in `SOURCE-PIN.json` are unchanged compiled runtime,
catalog, font and license bytes from DiscStudio 6.6.1 build
`28ac2b39fab85255`. The pin records the Git source checkpoint, original Pages
archive and adapter handoff archive separately. The handoff's proof HTML is
identified by hash but is excluded from the production package.

`thro-adapter.mjs` is the local integration boundary. It preserves the native
renderer and adds one prefix to unaddressed mold IDs, keeps null, undefined and
blank flight values unknown, and accepts optional panel-default scale. Finite
numbers and numeric strings retain their values, including zero; nonfinite or
invalid known values are rejected. Its original and
current hashes are both recorded in the pin. It is not attributed to the native
Git checkpoint.

```js
import { renderDiscStudioCard } from './thro-adapter.mjs';

const graphic = await renderDiscStudioCard({
  disc: { id: physicalDiscId, mold: 'ds.px.seed.mvp--servo', name: 'Servo', manufacturer: 'MVP' },
  photoSrc: preparedPhotoUrl,
  flights: [6, 5, -1, 1],
  preset: 'b01',
  placement: 'panel-default',
  scale: 0.66,
});
```

The return value is `{ svg, width, height, png, preset, orientation, appearance,
placement, build }`. `svg` embeds the rendered PNG; it does not recreate the
native design as vector drawing. Keep `png` transient. The caller owns frozen
disc facts, prepared-photo identity, requested settings and persistence.

Preset IDs are `u01`, `u02`, `u03-front`, `u03-behind`, `u04`, `u05`, and
`b01` through `b05`. Appearance uses native `discSide`, `highlightTarget`,
`accentColor`, optional `plate` (`see-through` or `solid`) and `frame` fields.
Defaults remain native. Missing explicit flights use the bundled mold catalog.

`placement: 'panel-default'` measures the native card's alpha bounds and uses
its existing corner-anchor calculation. Optional scale must be a finite number
from 0.5 to 1.5; omitting it retains exactly 0.66. A footprint that cannot fit is
rejected by the native geometry. `placement: 'native'` and explicit
`{ scale, dx, dy }` retain their existing semantics and ignore the panel-only
scale option. The returned placement is the resolved physical transform.

The global `vendor/discstudio-cards` source follows the existing
`vendor/studio-renderer` layout; it is not an Experience mount. The Experience
builder verifies every pinned native file and the current
adapter before writing output, copies only this declared closure plus this
README and pin into `dist/vendor/discstudio-cards`, and includes the declared
external source names and bytes in its source and artifact identities.
The font license is preserved at `fonts/DEJAVU-LICENSE.txt`.

Focused source checks from the PxCube source root:

```
node --test local/test/thro-discstudio-adapter.test.mjs local/test/thro-discstudio-vendor-pin.test.mjs
```

These checks establish mapping, placement and byte correspondence. Browser
rendering, integrated persistence and human visual acceptance require separate
executed evidence. This package adds no hosted authentication or telemetry.
