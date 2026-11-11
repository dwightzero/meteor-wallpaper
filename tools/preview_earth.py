"""
Offline preview of the "earth" camera mode (ray-traced Earth + radiating meteors).
Development aid only; the shipped renderer is three.js.
"""
import math
import numpy as np
from PIL import Image, ImageFilter, ImageDraw

W, H = 1600, 900
FOV = 52.0
ASPECT = W / H

rng = np.random.default_rng(5)

EARTH_R = 3.2
EARTH_C = np.array([100.0, 0.0, 0.0])
CAM = EARTH_C + np.array([0.0, 20.0, 0.0])
SUN_DIR = (np.array([0.0, 0.0, 0.0]) - EARTH_C)
SUN_DIR = SUN_DIR / np.linalg.norm(SUN_DIR)

# camera basis: yaw 0, pitch 0 -> looking +Z
f = np.array([0.0, 0.0, 1.0])
r = np.array([1.0, 0.0, 0.0])
u = np.array([0.0, 1.0, 0.0])

t = math.tan(math.radians(FOV / 2))
xs = (np.arange(W) + 0.5) / W * 2 - 1
ys = 1 - (np.arange(H) + 0.5) / H * 2
gx, gy = np.meshgrid(xs, ys)
dirs = (f[None, None, :]
        + (gx * t * ASPECT)[..., None] * r[None, None, :]
        + (gy * t)[..., None] * u[None, None, :])
dirs /= np.linalg.norm(dirs, axis=2, keepdims=True)

# ---------------------------------------------------------------- sky
n = 16000
rad = 5000 + rng.random(n) * 2500
uu = rng.random(n) * 2 - 1
tt = rng.random(n) * 2 * math.pi
ss = np.sqrt(1 - uu ** 2)
sp = np.stack([rad * ss * np.cos(tt), rad * uu, rad * ss * np.sin(tt)], axis=1)
d = sp - CAM
z = d @ f
x = d @ r
y = d @ u
zz = np.where(np.abs(z) < 1e-6, 1e-6, z)
px = (x / zz / (t * ASPECT) + 1) * 0.5 * W
py = (1 - y / zz / t) * 0.5 * H

img = np.zeros((H, W, 3))
img[:, :] = np.array([3, 5, 11]) / 255.0

xi = np.clip(px.astype(int), 0, W - 1)
yi = np.clip(py.astype(int), 0, H - 1)
bright = 0.25 + rng.random(n) ** 2.2 * 0.9
warm = rng.random(n) < 0.12
for c, mul in enumerate([0.95, 0.97, 1.0]):
    ch = np.zeros((H, W))
    np.add.at(ch, (yi, xi), bright * mul)
    ch = np.array(Image.fromarray(np.clip(ch * 255, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.8))) / 255
    img[:, :, c] += ch
    img[:, :, 2] += ch * 0.02

# ---------------------------------------------------------------- Earth (ray-sphere)
oc = CAM - EARTH_C
b = dirs @ (-oc)
c2 = oc @ oc - EARTH_R ** 2
disc = b * b - c2
hit = (disc > 0) & (b > 0)

if hit.any():
    t_hit = b - np.sqrt(np.maximum(disc, 0))
    p = CAM + dirs * np.where(hit, t_hit, 0)[..., None]
    nrm = (p - EARTH_C) / EARTH_R
    lam = np.clip(nrm @ SUN_DIR, 0, 1)
    # simple day/night shading + blue marble tint
    shade = 0.10 + 0.90 * np.clip(lam, 0, 1) ** 0.8
    earth_col = (np.array([0.10, 0.28, 0.62])[None, None, :] * shade[..., None])
    earth_col += np.array([0.02, 0.06, 0.12])[None, None, :]
    img[hit] = earth_col[hit]

# atmosphere rim: distance from the limb
b_limb = b
rim = np.exp(-((b_limb - EARTH_R) / 0.45) ** 2) * (b_limb > EARTH_R)
rim = np.where(hit, 0, rim)
img[:, :, 0] += rim * 0.18
img[:, :, 1] += rim * 0.34
img[:, :, 2] += rim * 0.55

# ---------------------------------------------------------------- meteors
RADIANT = np.array([0.42, 0.34, 0.84])
RADIANT = RADIANT / np.linalg.norm(RADIANT)
rp = CAM + RADIANT * 900

meteor_layer = np.zeros((H, W, 3))
dimg = Image.fromarray(np.zeros((H, W, 3), dtype=np.uint8))
draw = ImageDraw.Draw(dimg)

for _ in range(46):
    off = rng.normal(size=3)
    off = off / np.linalg.norm(off) * (rng.random() ** 0.7 * 260)
    head = rp + off
    dirv = off / np.linalg.norm(off)
    length = 40 + rng.random() * 80
    tail = head - dirv * length

    for pstart, pend, inten in [(tail, head, 1.0)]:
        a = pstart - CAM
        bb = pend - CAM
        if (a @ f) <= 1 or (bb @ f) <= 1:
            continue
        ax = (a @ r / (a @ f) / (t * ASPECT) + 1) * 0.5 * W
        ay = (1 - a @ u / (a @ f) / t) * 0.5 * H
        bx = (bb @ r / (bb @ f) / (t * ASPECT) + 1) * 0.5 * W
        by = (1 - bb @ u / (bb @ f) / t) * 0.5 * H
        draw.line([(ax, ay), (bx, by)], fill=(150, 200, 255), width=3)
        draw.ellipse([bx - 4, by - 4, bx + 4, by + 4], fill=(255, 255, 255))

arr = np.array(dimg).astype(np.float64) / 255.0
arr = np.array(Image.fromarray((arr * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.2))) / 255.0
img += arr * np.array([0.55, 0.75, 1.0])

# ---------------------------------------------------------------- vignette + tonemap
yy, xx = np.mgrid[0:H, 0:W]
dx = (xx - W / 2) / (W / 2)
dy = (yy - H * 0.42) / (H / 2)
vig = np.clip(1.0 - 0.42 * (0.25 * dx ** 2 + dy ** 2) ** 1.2, 0.4, 1.0)

img = img * vig[..., None]
img = img / (1 + img * 0.55)
img = np.clip(img ** (1 / 1.9), 0, 1)
Image.fromarray((img * 255).astype(np.uint8)).save(
    r"C:\Users\chishoushou\Documents\deepseek-harness\default-workspace\meteor-wallpaper\shots\preview-earth.png")
print("ok")

