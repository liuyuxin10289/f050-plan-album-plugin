from PIL import Image, ImageDraw

S = 1024
R = 232  # 背景圆角
top = (74, 155, 217)      # #4A9BD9
bottom = (12, 68, 124)    # #0C447C
line = (181, 212, 244)    # #B5D4F4 文字线
fold = (199, 219, 240)    # 折角

# 1) 垂直渐变背景
grad = Image.new('RGBA', (S, S), (0, 0, 0, 0))
px = grad.load()
for y in range(S):
    t = y / (S - 1)
    r = round(top[0] + (bottom[0] - top[0]) * t)
    g = round(top[1] + (bottom[1] - top[1]) * t)
    b = round(top[2] + (bottom[2] - top[2]) * t)
    for x in range(S):
        px[x, y] = (r, g, b, 255)

# 2) 圆角蒙版
mask = Image.new('L', (S, S), 0)
ImageDraw.Draw(mask).rounded_rectangle([0, 0, S - 1, S - 1], radius=R, fill=255)
grad.putalpha(mask)

# 3) 文档图形（白色文档 + 折角 + 3 条文字线）
doc = Image.new('RGBA', (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(doc)
d.rounded_rectangle([300, 200, 700, 700], radius=40, fill=(255, 255, 255, 255))
d.polygon([(700, 200), (540, 200), (700, 360)], fill=(fold[0], fold[1], fold[2], 255))
d.rounded_rectangle([352, 420, 648, 456], radius=18, fill=(line[0], line[1], line[2], 255))
d.rounded_rectangle([352, 496, 648, 532], radius=18, fill=(line[0], line[1], line[2], 255))
d.rounded_rectangle([352, 572, 536, 608], radius=18, fill=(line[0], line[1], line[2], 255))

img = Image.alpha_composite(grad, doc)
img.save('icon.png')
img.resize((256, 256), Image.LANCZOS).save('icon-256.png')
img.save('favicon.ico', sizes=[(16, 16), (32, 32), (48, 48), (64, 64)])
print('icon.png / icon-256.png / favicon.ico generated')
