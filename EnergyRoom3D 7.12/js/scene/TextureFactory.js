/**
 * TEXTURE FACTORY
 * Every material texture is generated procedurally on a <canvas> and
 * cached (same reuse philosophy as ModelFactory's geometry cache) - no
 * external image files, so it works fully offline from the CDN scripts
 * alone. Unity mapping: these would become authored Texture2D assets;
 * here they're baked once at runtime instead.
 */
const TextureFactory = (() => {
  const cache = new Map();

  function shade(hex, amt){
    const c = new THREE.Color(hex);
    const h = {h:0,s:0,l:0}; c.getHSL(h);
    c.setHSL(h.h, h.s, Math.max(0, Math.min(1, h.l + amt)));
    return '#'+c.getHexString();
  }
  function noise(ctx, w, h, alpha){
    const img = ctx.getImageData(0,0,w,h);
    const d = img.data;
    for (let i=0;i<d.length;i+=4){
      const n = (Math.random()-0.5)*alpha*255;
      d[i]+=n; d[i+1]+=n; d[i+2]+=n;
    }
    ctx.putImageData(img,0,0);
  }
  function cnv(size){ const c=document.createElement('canvas'); c.width=c.height=size; return c; }
  function finish(key, canvas, repeatX, repeatY){
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeatX||4, repeatY||4);
    tex.anisotropy = 4;
    cache.set(key, tex);
    return tex;
  }
  function get(key, build){
    if (cache.has(key)) return cache.get(key);
    return build();
  }

  return {
    /** Wood plank floor: alternating plank shade + grain lines + seams */
    wood(base=0x8a5a37){
      const key='wood:'+base;
      return get(key, ()=>{
        const S=256, c=cnv(S), ctx=c.getContext('2d');
        ctx.fillStyle = shade(base, 0); ctx.fillRect(0,0,S,S);
        const plankH = 26;
        for (let y=0; y<S; y+=plankH){
          ctx.fillStyle = shade(base, (Math.random()-0.5)*0.09);
          ctx.fillRect(0,y,S,plankH-1);
          ctx.strokeStyle = 'rgba(40,20,5,0.18)';
          ctx.lineWidth = 1;
          for (let g=0; g<4; g++){
            const yy = y + 3 + Math.random()*(plankH-6);
            ctx.beginPath(); ctx.moveTo(0,yy);
            for (let x=8; x<=S; x+=8) ctx.lineTo(x, yy+(Math.random()-0.5)*2.2);
            ctx.stroke();
          }
          ctx.strokeStyle='rgba(20,10,2,0.35)'; ctx.beginPath(); ctx.moveTo(0,y+plankH-1); ctx.lineTo(S,y+plankH-1); ctx.stroke();
          // occasional plank end-seam
          if (Math.random()<0.7){
            const sx = 40+Math.random()*(S-80);
            ctx.beginPath(); ctx.moveTo(sx,y); ctx.lineTo(sx,y+plankH); ctx.stroke();
          }
        }
        noise(ctx, S, S, 0.02);
        return finish(key, c, 3.2, 3.2);
      });
    },
    /** Ceramic tile floor: grid of tiles with grout lines + subtle speckle */
    tile(base=0xcfd6dd){
      const key='tile:'+base;
      return get(key, ()=>{
        const S=256, c=cnv(S), ctx=c.getContext('2d');
        ctx.fillStyle = '#9aa1a8'; ctx.fillRect(0,0,S,S); // grout base
        const n=4, cell=S/n, pad=3;
        for (let ty=0; ty<n; ty++) for (let tx=0; tx<n; tx++){
          ctx.fillStyle = shade(base, (Math.random()-0.5)*0.05);
          ctx.fillRect(tx*cell+pad, ty*cell+pad, cell-pad*2, cell-pad*2);
        }
        noise(ctx, S, S, 0.015);
        return finish(key, c, 3.5, 3.5);
      });
    },
    /** Carpet: dense fuzzy noise, low sheen */
    carpet(base=0x5b4a63){
      const key='carpet:'+base;
      return get(key, ()=>{
        const S=128, c=cnv(S), ctx=c.getContext('2d');
        ctx.fillStyle = shade(base,0); ctx.fillRect(0,0,S,S);
        noise(ctx, S, S, 0.09);
        return finish(key, c, 5, 5);
      });
    },
    /** Poured concrete: mottled speckle + faint expansion-joint grid */
    concrete(base=0x8b8f96){
      const key='concrete:'+base;
      return get(key, ()=>{
        const S=256, c=cnv(S), ctx=c.getContext('2d');
        ctx.fillStyle = shade(base,0); ctx.fillRect(0,0,S,S);
        noise(ctx, S, S, 0.05);
        ctx.strokeStyle='rgba(0,0,0,0.12)'; ctx.lineWidth=2;
        ctx.beginPath(); ctx.moveTo(S/2,0); ctx.lineTo(S/2,S); ctx.moveTo(0,S/2); ctx.lineTo(S,S/2); ctx.stroke();
        return finish(key, c, 2.5, 2.5);
      });
    },
    /** Interior wall: subtle plaster noise, almost flat */
    plaster(base=0xefeee9){
      const key='plaster:'+base;
      return get(key, ()=>{
        const S=128, c=cnv(S), ctx=c.getContext('2d');
        ctx.fillStyle = shade(base,0); ctx.fillRect(0,0,S,S);
        noise(ctx, S, S, 0.018);
        return finish(key, c, 2.5, 1.4);
      });
    },
    /** Brick wall: running-bond brick pattern with mortar */
    brick(base=0x9c5b47){
      const key='brick:'+base;
      return get(key, ()=>{
        const S=256, c=cnv(S), ctx=c.getContext('2d');
        ctx.fillStyle = '#8f8478'; ctx.fillRect(0,0,S,S); // mortar
        const bw=48, bh=20, gap=4;
        let row=0;
        for (let y=0; y<S; y+=bh+gap){
          const offset = (row%2)*(bw/2);
          for (let x=-bw; x<S+bw; x+=bw+gap){
            ctx.fillStyle = shade(base, (Math.random()-0.5)*0.12);
            ctx.fillRect(x+offset, y, bw, bh);
          }
          row++;
        }
        noise(ctx, S, S, 0.02);
        return finish(key, c, 2.2, 1.2);
      });
    },
    /** Grass ground: layered green speckle for a natural lawn look */
    grass(base=0x3f6b3a){
      const key='grass:'+base;
      return get(key, ()=>{
        const S=256, c=cnv(S), ctx=c.getContext('2d');
        ctx.fillStyle = shade(base,0); ctx.fillRect(0,0,S,S);
        for (let i=0;i<2200;i++){
          const x=Math.random()*S, y=Math.random()*S;
          ctx.fillStyle = shade(base, (Math.random()-0.5)*0.28);
          ctx.fillRect(x,y,2,2);
        }
        return finish(key, c, 22, 22);
      });
    },
    /** Asphalt driveway: dark speckle */
    asphalt(base=0x2b2d31){
      const key='asphalt:'+base;
      return get(key, ()=>{
        const S=128, c=cnv(S), ctx=c.getContext('2d');
        ctx.fillStyle = shade(base,0); ctx.fillRect(0,0,S,S);
        noise(ctx, S, S, 0.06);
        return finish(key, c, 3, 6);
      });
    },
  };
})();
