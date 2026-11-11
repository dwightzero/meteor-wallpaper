"""
CPU composition preview for a generated system (seed -> spec -> PNG).

This is NOT the WebGL renderer: it re-implements the same camera and point-cloud
math so framing/density can be judged without a browser. Colours and glow are
approximate - never tune them from this image.

usage: python tools/preview_spec.py .tmp/spec-123.json shots/seed-123.png
"""
import json
import math
import sys

import numpy as np
from PIL import Image, ImageFilter

W, H = 1600, 900
ASPECT = W / H


def normalize(v):
    n = np.linalg.norm(v)
    return v / n if n else v


def basis(pos, target):
    f = normalize(target - pos)
    up = np.array([0.0, 1.0, 0.0])
    r = normalize(np.cross(f, up))
    u = np.cross(r, f)
    return f, r, u


def project(pts, pos, f, r, u, fov):
    d = pts - pos
    z = d @ f
    x = d @ r
    y = d @ u
    t = math.tan(math.radians(fov / 2))
    zz = np.where(np.abs(z) < 1e-6, 1e-6, z)
    sx = (x / zz) / (t * ASPECT)
    sy = (y / zz) / t
    return (sx + 1) * 0.5 * W, (1 - sy) * 0.5 * H, z


def splat(buf, px, py, intensity):
    h, w = buf.shape
    xi = np.clip(px.astype(int), 0, w - 1)
    yi = np.clip(py.astype(int), 0, h - 1)
    ok = (px >= -2) & (px < w + 2) & (py >= -2) & (py < h + 2) & (intensity > 0)
    np.add.at(buf, (yi[ok], xi[ok]), intensity[ok])


def gauss(buf, cx, cy, amp, sigma):
    """Add a clipped gaussian disc of one colour channel."""
    h, w = buf.shape
    if sigma <= 0 or amp <= 0:
        return
    x0, x1 = int(max(0, cx - 3 * sigma)), int(min(w, cx + 3 * sigma + 1))
    y0, y1 = int(max(0, cy - 3 * sigma)), int(min(h, cy + 3 * sigma + 1))
    if x1 <= x0 or y1 <= y0:
        return
    xs = np.arange(x0, x1)
    ys = np.arange(y0, y1)
    gx = np.exp(-((xs - cx) ** 2) / (2 * sigma ** 2))
    gy = np.exp(-((ys - cy) ** 2) / (2 * sigma ** 2))
    buf[y0:y1, x0:x1] += amp * np.outer(gy, gx)


def sprite_px(world_diameter, distance, fov):
    return math.tan(math.atan((world_diameter / 2) / max(distance, 1e-3))) / math.tan(math.radians(fov / 2)) * (H / 2)


def rgb(hexval):
    return np.array([(hexval >> 16) & 255, (hexval >> 8) & 255, hexval & 255]) / 255.0


def rot_x(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[1, 0, 0], [0, c, -s], [0, s, c]])


def rot_y(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])


def rot_z(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])


def main(spec_path, out_path):
    spec = json.load(open(spec_path, encoding="utf-8"))
    rng = np.random.default_rng(spec["seed"] & 0x7FFFFFFF)
    fov = spec["camera"]["fov"]

    az, el, dist = spec["camera"]["azimuth"], spec["camera"]["elevation"], spec["camera"]["distance"]
    cam = np.array([
        math.cos(az) * math.cos(el) * dist,
        math.sin(el) * dist + 10,
        math.sin(az) * math.cos(el) * dist,
    ])
    f, r, u = basis(cam, np.zeros(3))

    buf = np.zeros((H, W, 3))
    buf[:, :] = np.array([3, 5, 11]) / 255.0

    # stars
    n = 16000
    rad = 5000 + rng.random(n) * 2500
    uu = rng.random(n) * 2 - 1
    tt = rng.random(n) * 2 * math.pi
    ss = np.sqrt(1 - uu ** 2)
    sp = np.stack([rad * ss * np.cos(tt), rad * uu, rad * ss * np.sin(tt)], axis=1)
    px, py, z = project(sp, cam, f, r, u, fov)
    bright = 0.25 + rng.random(n) ** 2.2 * 0.9
    col = np.tile(np.array([0.92, 0.95, 1.0]), (n, 1))
    warm = rng.random(n) < 0.12
    blue = (rng.random(n) >= 0.12) & (rng.random(n) < 0.35)
    col[warm] = [1.0, 0.86, 0.72]
    col[blue] = [0.72, 0.83, 1.0]
    for c in range(3):
        ch = np.zeros((H, W))
        splat(ch, px, py, bright * col[:, c] * 0.9)
        buf[:, :, c] += ch

    # milky way
    n = 42000
    ang = rng.random(n) * 2 * math.pi
    spread = (rng.random(n) + rng.random(n) + rng.random(n) - 1.5) * 0.22
    rr = 4300 + rng.random(n) * 600
    v = np.stack([np.cos(ang) * rr, spread * rr, np.sin(ang) * rr], axis=1)
    bx, by, bz = spec["sky"]["band"]
    v = v @ (rot_z(bz) @ rot_y(by) @ rot_x(bx)).T
    px, py, z = project(v, cam, f, r, u, fov)
    ch = np.zeros((H, W))
    splat(ch, px, py, np.full(n, 0.05))
    mc = rgb(spec["sky"]["milky"])
    for c in range(3):
        buf[:, :, c] += ch * mc[c]

    # sun
    star = spec["star"]
    sx, sy, sz = project(np.array([[0.0, 0.0, 0.0]]), cam, f, r, u, fov)
    cx, cy, sdist = float(sx[0]), float(sy[0]), float(sz[0])
    g = star["glowScale"]

    # The sprite textures are mostly transparent near the rim, so a gaussian with
    # the full sprite radius would smear far more light than the real render does.
    for size, amp, hexval, k in [(64 * g, 0.95, star["core"], 0.26),
                                 (170 * g, 0.16, star["halo"], 0.30),
                                 (380 * g, 0.035, star["outer"], 0.22)]:
        sc = rgb(hexval)
        rad_px = max(1.5, sprite_px(size, sdist, fov) / 2)
        sigma = max(1.2, rad_px * k)
        for c in range(3):
            gauss(buf[:, :, c], cx, cy, amp * sc[c], sigma)

    core_px = max(1.5, sprite_px(star["radius"] * 2, sdist, fov) / 2)
    cc = rgb(star["core"])
    for c in range(3):
        gauss(buf[:, :, c], cx, cy, 1.6 * cc[c], core_px)

    # planets
    planets = spec["planets"]
    for i, p in enumerate(planets):
        pos = np.array([[math.cos(p["phase"]) * p["r"], 0, math.sin(p["phase"]) * p["r"]]])
        px, py, z = project(pos, cam, f, r, u, fov)
        if z[0] <= 0:
            continue
        sigma = max(1.0, sprite_px(p["radius"] * 2, float(z[0]), fov) / 2)
        pc = rgb(p["color"])
        for c in range(3):
            gauss(buf[:, :, c], float(px[0]), float(py[0]), 0.9 * pc[c], sigma)

    # atmosphere halo on the home world
    home = planets[spec["viewpoint"]]
    pos = np.array([[math.cos(home["phase"]) * home["r"], 0, math.sin(home["phase"]) * home["r"]]])
    px, py, z = project(pos, cam, f, r, u, fov)
    if z[0] > 0:
        sigma = max(2.0, sprite_px(home["radius"] * 6.5, float(z[0]), fov) / 2)
        halo = np.array([0.35, 0.6, 1.0])
        for c in range(3):
            gauss(buf[:, :, c], float(px[0]), float(py[0]), 0.45 * halo[c], sigma)

    # dust belts
    for belt in spec["belts"]:
        n = belt["count"]
        theta = rng.random(n) * 2 * math.pi
        rr = (belt["a"] * (1 - belt["e"] ** 2)) / (1 + belt["e"] * np.cos(theta))
        x = np.cos(theta) * rr
        zz = np.sin(theta) * rr
        gauss4 = lambda k: (rng.random(k) + rng.random(k) + rng.random(k) + rng.random(k) - 2) * 1.6
        nx = gauss4(n) * belt["width"]
        ny = gauss4(n) * belt["width"] * 0.78
        pts = np.stack([x + nx, ny, zz + nx * 0.4], axis=1)
        pts = pts @ rot_x(belt["inc"]).T
        pts = pts @ rot_y(belt["node"]).T
        px, py, z = project(pts, cam, f, r, u, fov)
        ch = np.zeros((H, W))
        ok = z > 0
        splat(ch, px[ok], py[ok], np.full(int(ok.sum()), 0.14))
        ch = np.array(Image.fromarray(np.clip(ch * 255, 0, 255).astype(np.uint8))
                      .filter(ImageFilter.GaussianBlur(1))) / 255
        bc = rgb(belt["color"])
        for c in range(3):
            buf[:, :, c] += ch * bc[c]

    # vignette + cheap tonemap (matches the look of preview.py)
    yy, xx = np.mgrid[0:H, 0:W]
    dx = (xx - W / 2) / (W / 2)
    dy = (yy - H * 0.42) / (H / 2)
    vig = np.clip(1.0 - 0.42 * (dx ** 2 * 0.8 + dy ** 2) ** 1.35, 0.35, 1.0)

    img = buf * vig[..., None]
    img = img / (1 + img * 0.55)
    img = np.clip(img ** (1 / 1.9), 0, 1)
    Image.fromarray((img * 255).astype(np.uint8)).save(out_path)
    print(f"{out_path}: planets={len(planets)} belts={len(spec['belts'])} "
          f"star={star['name']} outer={planets[-1]['r']:.0f} dist={dist:.0f} mean={img.mean():.3f}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(__doc__)
        sys.exit(2)
    main(sys.argv[1], sys.argv[2])
