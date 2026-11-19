# Synthetic progress photos

`synthetic-front.png` and `synthetic-side.png` are AI-generated fixtures of a
fictional adult. They contain no real person's health data. Both are labeled
**SYNTHETIC DEMO** and show the same body in two poses, without a transformation
claim. Created with the built-in imagegen tool on 2026-11-19.

Front prompt:

> Use case: photorealistic-natural. Asset: fictional progress-photo fixture for
> a health app demo. Generate one portrait full-body photo of a fictional adult
> woman around 35, average build, dark shoulder-length hair, standing comfortably
> facing camera in a plain neutral room. Fully clothed in a loose plain blue
> T-shirt, black exercise leggings and socks. Natural window light, ordinary
> candid smartphone photo, neutral expression. Entire person visible with space
> around head and feet. No body transformation claim, no before/after, no
> measurements, no logos. Prominent legible footer text exactly "SYNTHETIC DEMO"
> in a white banner. Single photo, no collage.

Side prompt (front image used as the reference):

> Create a second fictional demo photo using the attached fictional person as
> reference. Keep the same adult woman, body shape, loose blue T-shirt, black
> leggings, socks, plain room, natural lighting and full-body portrait framing.
> Change only the pose: she is standing in a relaxed side profile, facing right.
> Do not change body size or suggest any before/after transformation. Preserve
> prominent footer banner with text exactly "SYNTHETIC DEMO". One photo only.

The seed sanitizes the images through the normal server pipeline and writes
real files through the private storage lifecycle. Hashes deduplicate successive
refreshes. The committed PNGs are public synthetic fixtures; uploaded private
objects remain subject-scoped like other progress photos.
