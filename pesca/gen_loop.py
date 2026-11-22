W=800
BLUE='#3d6e91'; TAG='#e0822e'; RED='#d6453d'; GREY='#6b7177'
def head(a,H,title,sub):
    a(f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" font-family="Arial, Helvetica, sans-serif">')
    a(f'<defs><marker id="ar" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="{RED}"/></marker><marker id="at" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="{TAG}"/></marker></defs>')
    a(f'<rect width="{W}" height="{H}" fill="#f7f4ee"/>')
    a(f'<text x="400" y="56" text-anchor="middle" font-size="35" font-weight="bold" fill="#1f2a36">{title}</text>')
    a(f'<text x="400" y="92" text-anchor="middle" font-size="20" fill="#5a6470">{sub}</text>')
def p(a,d,c,w=5,end=''):
    m=f' marker-end="url(#{end})"' if end else ''
    a(f'<path d="{d}" fill="none" stroke="{c}" stroke-width="{w}" stroke-linecap="round" stroke-linejoin="round"{m}/>')
def txt(a,x,y,t,s=18,c='#1f2a36',b=False,anc='start'):
    a(f'<text x="{x}" y="{y}" font-size="{s}" fill="{c}" text-anchor="{anc}"{" font-weight=\"bold\"" if b else ""}>{t}</text>')

# ---------- Imagen 1: nudo de lazo ----------
o=[];a=o.append
H=1900
head(a,H,'Nudo de lazo (Non-Slip Loop)','Para atar el señuelo al líder dejando que se mueva libre')
a(f'<rect x="200" y="108" width="400" height="34" rx="17" fill="#fff" stroke="#e1dbcf"/>')
p(a,'M222 125 L262 125',BLUE); txt(a,270,131,'nylon (hacia el girador)',16,'#1f2a36')
p(a,'M455 125 L485 125',TAG); txt(a,492,131,'la punta',16,'#1f2a36')

def lure_nose(y,ex=600):
    a(f'<path d="M{ex+12} {y-30} Q {ex+40} {y-34} 790 {y-26} L 790 {y+26} Q {ex+40} {y+34} {ex+12} {y+30} Z" fill="#e8ecef" stroke="#a9b0b6" stroke-width="3"/>')
    a(f'<rect x="{ex+8}" y="{y-30}" width="12" height="60" rx="5" fill="#d64b45"/>')
    a(f'<circle cx="{ex}" cy="{y}" r="12" fill="none" stroke="{GREY}" stroke-width="5"/>')
    a(f'<line x1="{ex+12}" y1="{y}" x2="{ex+20}" y2="{y}" stroke="{GREY}" stroke-width="5"/>')

def overhand(y):
    p(a,f'M80 {y} L300 {y} C 335 {y}, 360 {y-30}, 340 {y-58} C 320 {y-82}, 280 {y-66}, 292 {y-38} C 300 {y-18}, 318 {y-6}, 350 {y}',BLUE)

def panel(top,n,title,sub,h=255):
    a(f'<rect x="30" y="{top}" width="740" height="{h}" rx="16" fill="#fff" stroke="#e1dbcf" stroke-width="2"/>')
    a(f'<circle cx="70" cy="{top+38}" r="21" fill="{RED}"/>'); txt(a,70,top+46,str(n),23,'#fff',True,'middle')
    txt(a,104,top+38,title,22,'#1f2a36',True); txt(a,104,top+64,sub,17,'#5a6470')

steps=[
 ('Haz un nudo simple flojo','A unos 10 cm de la punta. No lo aprietes.'),
 ('Pasa la punta por el ojo del señuelo','Y regrésala hacia el nudo.'),
 ('Mete la punta por dentro del nudo simple','Por el mismo lado por donde sale el nylon.'),
 ('Enrolla la punta 3 veces en el nylon','Con 60 lb bastan 2–3 vueltas.'),
 ('Vuelve a pasar la punta por el nudo simple','Por el mismo lado por donde salió.'),
 ('Moja, ajusta el lazo y aprieta','Deja el lazo de 0,5–1 cm. Corta la punta a 3 mm.'),
]
top=160
for i,(ti,su) in enumerate(steps):
    n=i+1; panel(top,n,ti,su); y=top+175
    if n<6:
        overhand(y); lure_nose(y)
        if n==1:
            p(a,f'M350 {y} L470 {y}',TAG)
            txt(a,300,y+40,'nudo simple flojo',16,RED,True,'middle')
        else:
            p(a,f'M350 {y} L588 {y} C 628 {y}, 628 {y+30}, 588 {y+30} L470 {y+30}',TAG,end='at' if n==2 else '')
        if n>=3:
            p(a,f'M470 {y+30} C 400 {y+30}, 345 {y-10}, 318 {y-36} L 262 {y-62}',TAG,end='at' if n==3 else '')
        if n>=4:
            # 3 vueltas alrededor del nylon azul
            pts=f'M262 {y-62} C 250 {y-40}, 245 {y-10}, 240 {y+14} '
            xs=[240,205,170]
            for k,x in enumerate(xs):
                pts+=f'C 236 {y+30}, {x-4} {y+28}, {x-6} {y+10} ' if k==0 else ''
            a(f'<g fill="none" stroke="{TAG}" stroke-width="5">')
            for x in xs:
                a(f'<ellipse cx="{x}" cy="{y}" rx="9" ry="20" transform="rotate(20 {x} {y})"/>')
            a('</g>')
            p(a,f'M262 {y-62} C 255 {y-40}, 250 {y-25}, 245 {y-18}',TAG)
            p(a,f'M80 {y} L300 {y}',BLUE)  # redibuja nylon encima de parte de las vueltas
            for x in xs:
                p(a,f'M{x-6} {y-12} C {x-2} {y-4}, {x+2} {y+4}, {x+6} {y+12}',TAG)
            if n==4:
                p(a,f'M165 {y+22} C 150 {y+40}, 140 {y+45}, 125 {y+45}',TAG,end='at')
                txt(a,205,y+55,'3 vueltas',16,RED,True,'middle')
        if n>=5:
            p(a,f'M165 {y+22} C 200 {y+60}, 270 {y+20}, 300 {y-22} L 330 {y-50} L 380 {y-80}',TAG,end='at')
            txt(a,400,y-80,'sale por aquí',16,RED,True)
        if n==3:
            txt(a,200,y-70,'entra al nudo',16,RED,True,'middle')
    else:
        # final apretado
        p(a,f'M80 {y} L300 {y}',BLUE)
        a(f'<rect x="298" y="{y-11}" width="44" height="22" rx="8" fill="{BLUE}"/>')
        for k in range(4): a(f'<line x1="{304+k*10}" y1="{y-11}" x2="{308+k*10}" y2="{y+11}" stroke="#244a66" stroke-width="2"/>')
        p(a,f'M342 {y-5} C 372 {y-12}, 392 {y-16}, 404 {y-10}',BLUE)
        p(a,f'M342 {y+5} C 372 {y+12}, 392 {y+16}, 404 {y+10}',BLUE)
        p(a,f'M340 {y-10} L352 {y-22}',TAG)
        lure_nose(y,ex=410)
        a(f'<line x1="342" y1="{y+42}" x2="410" y2="{y+42}" stroke="#1f2a36" stroke-width="2"/><line x1="342" y1="{y+34}" x2="342" y2="{y+50}" stroke="#1f2a36" stroke-width="2"/><line x1="410" y1="{y+34}" x2="410" y2="{y+50}" stroke="#1f2a36" stroke-width="2"/>')
        txt(a,376,y+70,'lazo 0,5–1 cm',16,RED,True,'middle')
        p(a,f'M200 {y-30} L110 {y-30}',RED,3,'ar'); txt(a,155,y-40,'tira',16,RED,True,'middle')
        txt(a,470,y+62,'✓ el señuelo se mueve libre',17,'#2e7d4f',True)
    top+=270
a(f'<rect x="30" y="{top}" width="740" height="{H-top-20}" rx="14" fill="#fff" stroke="#d9d3c7" stroke-width="2"/>')
txt(a,400,top+34,'Antes de apretar del todo, desliza el nudo simple hacia el señuelo',18,anc='middle')
txt(a,400,top+60,'para que el lazo quede chico: así el anzuelo no se engancha en él.',18,anc='middle')
a('</svg>'); open('nudo-lazo.svg','w').write('\n'.join(o))

# ---------- Imagen 2: sistema ----------
o=[];a=o.append
H=1600
head(a,H,'Sistema de líderes intercambiables','Un snap fijo en tu línea · cada señuelo con su propio líder')
def bswivel(x,y,s=1):
    a(f'<g stroke="#3a3f45" stroke-width="5" fill="none"><circle cx="{x}" cy="{y}" r="{14*s}"/><circle cx="{x}" cy="{y+100*s}" r="{14*s}"/></g>')
    a(f'<ellipse cx="{x}" cy="{y+50*s}" rx="{19*s}" ry="{32*s}" fill="#8b9299" stroke="#3a3f45" stroke-width="4"/>')
    a(f'<ellipse cx="{x-5}" cy="{y+40*s}" rx="{5*s}" ry="{12*s}" fill="#d7dadd"/>')
def loopknot(x,y):
    a(f'<rect x="{x-8}" y="{y-14}" width="16" height="22" rx="6" fill="{BLUE}"/>')
    p(a,f'M{x-4} {y+8} C {x-8} {y+18}, {x-6} {y+26}, {x} {y+28} C {x+6} {y+26}, {x+8} {y+18}, {x+4} {y+8}',BLUE,4)
def treble(x,y):
    p(a,f'M{x} {y} L{x} {y+22} M{x} {y+22} q -14 4 -14 -10 M{x} {y+22} q 14 4 14 -10',GREY,3)

# Carrete y trenzado
a('<rect x="350" y="120" width="100" height="56" rx="12" fill="#c9a227" stroke="#7a6214" stroke-width="3"/><rect x="362" y="131" width="76" height="34" rx="6" fill="#4d6b3a"/>')
p(a,'M400 176 L400 290','#4d6b3a',4); txt(a,420,240,'Trenzado 20 lb',20,'#4d6b3a',True)
a(f'<ellipse cx="400" cy="296" rx="10" ry="13" fill="#2f4424"/>'); txt(a,420,302,'Palomar',18,RED,True)
# snap con girador (abierto)
a('<g stroke="#3a3f45" stroke-width="5" fill="none"><circle cx="400" cy="322" r="14"/><circle cx="400" cy="414" r="14"/></g>')
a('<ellipse cx="400" cy="368" rx="17" ry="29" fill="#8b9299" stroke="#3a3f45" stroke-width="4"/>')
p(a,'M400 428 L400 452 L376 548 Q 400 562 424 548 L 418 520','#3a3f45',5)
p(a,'M418 520 L 440 470','#3a3f45',5)
txt(a,450,370,'Snap con girador',22,'#1f2a36',True)
txt(a,450,396,'queda FIJO en tu línea',18,'#5a6470')
txt(a,450,500,'← se abre aquí',18,RED,True)

# flecha a lideres
p(a,'M400 575 L400 640',RED,3,'ar'); txt(a,415,615,'engancha el líder que quieras',18,RED,True)

xs=[160,400,640]; top=670
names=[('Popper','nudo de lazo'),('Minnow','nudo de lazo'),('Vinilo con plomo','clinch o lazo')]
for i,x in enumerate(xs):
    a(f'<rect x="{x-110}" y="{top-10}" width="220" height="760" rx="16" fill="#fff" stroke="#e1dbcf" stroke-width="2"/>')
    bswivel(x,top+25,0.8)
    txt(a,x+28,top+70,'girador',15,'#5a6470'); txt(a,x+28,top+88,'barril',15,'#5a6470')
    p(a,f'M{x} {top+116} L{x} {top+470}','#8fb3cc',6)
    a(f'<ellipse cx="{x}" cy="{top+118}" rx="7" ry="10" fill="#6e8aa0"/>')
    txt(a,x-12,top+300,'líder 80–100 cm',15,'#3d6e91',True,'middle') if False else None
    a(f'<text x="{x-14}" y="{top+295}" font-size="16" fill="#3d6e91" font-weight="bold" text-anchor="middle" transform="rotate(-90 {x-14} {top+295})">líder 80–100 cm</text>')
    loopknot(x,top+480)
    txt(a,x+14,top+488,names[i][1],14,RED,True)
    ly=top+515
    if i==0: # popper
        a(f'<path d="M{x-20} {ly} L{x+20} {ly} L{x+16} {ly+120} Q {x} {ly+150} {x-16} {ly+120} Z" fill="#e3eaf0" stroke="#9aa5ad" stroke-width="3"/>')
        a(f'<ellipse cx="{x}" cy="{ly+2}" rx="21" ry="7" fill="#d64b45" stroke="#a5302b" stroke-width="2"/>')
        a(f'<circle cx="{x+9}" cy="{ly+18}" r="4" fill="#222"/>')
        treble(x-18,ly+55); treble(x,ly+140)
    elif i==1: # minnow
        a(f'<path d="M{x} {ly+10} C {x+22} {ly+30}, {x+20} {ly+120}, {x} {ly+165} C {x-20} {ly+120}, {x-22} {ly+30}, {x} {ly+10} Z" fill="#f3f3f3" stroke="#9aa5ad" stroke-width="3"/>')
        a(f'<path d="M{x} {ly+10} C {x+22} {ly+30}, {x+20} {ly+50}, {x+18} {ly+60} L {x-18} {ly+60} C {x-20} {ly+50}, {x-22} {ly+30}, {x} {ly+10} Z" fill="#d64b45"/>')
        a(f'<circle cx="{x+8}" cy="{ly+34}" r="5" fill="#e2c046" stroke="#222" stroke-width="2"/>')
        treble(x-20,ly+70); treble(x,ly+165)
    else: # jig
        a(f'<circle cx="{x}" cy="{ly+22}" r="20" fill="#7d7f80" stroke="#4a4c4d" stroke-width="3"/>')
        a(f'<path d="M{x-12} {ly+38} C {x-16} {ly+90}, {x-10} {ly+130}, {x} {ly+150} L {x-16} {ly+178} L {x+18} {ly+178} L {x+4} {ly+150} C {x+12} {ly+120}, {x+16} {ly+80}, {x+12} {ly+38} Z" fill="#eef1f3" stroke="#9aa5ad" stroke-width="3"/>')
        p(a,f'M{x+12} {ly+70} L{x+26} {ly+92} q 4 10 -8 10','#a9b0b6',4)
    txt(a,x,top+735,names[i][0],20,'#1f2a36',True,'middle')

y0=top+775
a(f'<rect x="30" y="{y0}" width="740" height="{H-y0-20}" rx="14" fill="#fff" stroke="#d9d3c7" stroke-width="2"/>')
lines=['Para cambiar: abre el snap → saca el líder → engancha otro → ciérralo.',
       'El snap queda a 1 m del señuelo: no le quita movimiento.',
       'Guarda cada líder enrollado en un cartón con su señuelo.',
       'El líder de plomada también se engancha al mismo snap.']
for k,l in enumerate(lines): txt(a,400,y0+36+k*30,l,18,anc='middle')
a('</svg>'); open('sistema-lideres.svg','w').write('\n'.join(o))
