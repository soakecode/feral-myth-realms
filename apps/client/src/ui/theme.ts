/**
 * Shared gothic-gold design language for every full-screen panel (auth, class
 * select, lobby): moonlit-forest gradient backdrop, vignette, Cinzel
 * typography, ornate gold cards.
 */
export function gothicScreen(id: string, inner: string, opts?: { wide?: boolean }): string {
  return `
    <style>
      #${id}{position:absolute;inset:0;overflow:hidden auto;display:flex;flex-direction:column;align-items:center;
        justify-content:center;font-family:'Cinzel',Georgia,serif;color:#efe4cb;background:#080b10;padding:18px;box-sizing:border-box}
      #${id} .gbg{position:fixed;inset:-4%;z-index:0;animation:gkb 44s ease-in-out infinite alternate;background:
        radial-gradient(circle at 72% 16%, rgba(214,226,255,.22) 0%, rgba(150,175,220,.07) 9%, rgba(0,0,0,0) 18%),
        radial-gradient(ellipse at 50% -12%, #2c3f56 0%, rgba(24,33,46,.7) 38%, rgba(8,10,14,0) 68%),
        radial-gradient(ellipse at 18% 112%, #16241a 0%, rgba(14,22,16,.6) 36%, rgba(8,10,14,0) 66%),
        radial-gradient(ellipse at 86% 108%, #241a10 0%, rgba(26,18,11,.5) 30%, rgba(8,10,14,0) 60%),
        linear-gradient(180deg,#0c1119,#07090d)}
      #${id} .gvig{position:fixed;inset:0;z-index:0;pointer-events:none;background:
        radial-gradient(ellipse at 50% 40%,rgba(8,11,16,0) 0%,rgba(8,11,16,.5) 64%,rgba(5,7,10,.94) 100%)}
      @keyframes gkb{0%{transform:scale(1.02) translate(0,0)}100%{transform:scale(1.07) translate(-1%,-1.2%)}}
      #${id} .gcard{position:relative;z-index:1;width:${opts?.wide ? 'min(560px,94vw)' : 'min(380px,92vw)'};
        background:linear-gradient(168deg,rgba(24,19,12,.94),rgba(10,9,8,.96));
        border:1px solid rgba(255,216,138,.38);border-radius:14px;padding:26px clamp(18px,5vw,34px);
        box-shadow:0 26px 90px rgba(0,0,0,.75),inset 0 1px 0 rgba(255,236,180,.12);max-height:92vh;overflow-y:auto}
      #${id} .gcard::before{content:"";position:absolute;inset:5px;border:1px solid rgba(255,216,138,.14);border-radius:10px;pointer-events:none}
      #${id} .gtitle{font-family:'Cinzel Decorative','Cinzel',serif;font-weight:700;font-size:clamp(19px,4vw,24px);
        color:#ffd98a;letter-spacing:1px;text-shadow:0 0 18px rgba(255,200,90,.35);margin:0 0 2px}
      #${id} .gsub{font-size:12px;letter-spacing:1.5px;color:#a99a78;margin:0 0 18px}
      #${id} .gorna{display:flex;align-items:center;gap:10px;margin:0 0 14px;color:#ffd98a;font-size:13px}
      #${id} .gorna i{display:block;flex:1;height:1px;background:linear-gradient(90deg,transparent,rgba(255,216,138,.55),transparent)}
      #${id} .glabel{display:block;font-size:11px;letter-spacing:1.4px;text-transform:uppercase;color:#b9a777;margin:0 0 5px}
      #${id} .ginput{width:100%;box-sizing:border-box;padding:11px 13px;margin-bottom:13px;font-family:'Cinzel',Georgia,serif;
        background:rgba(8,7,5,.62);border:1px solid rgba(255,216,138,.3);border-radius:8px;color:#f5ead0;font-size:14px;
        letter-spacing:.5px;outline:none;transition:border-color .15s,box-shadow .15s}
      #${id} .ginput:focus{border-color:#ffd98a;box-shadow:0 0 14px rgba(255,200,90,.22)}
      #${id} .ginput::placeholder{color:rgba(214,196,158,.4);letter-spacing:.4px}
      #${id} .gbtn{width:100%;box-sizing:border-box;padding:13px;border-radius:9px;cursor:pointer;margin-top:6px;
        font-family:'Cinzel',Georgia,serif;font-weight:700;font-size:14px;letter-spacing:1.6px;
        transition:transform .1s,filter .2s,box-shadow .2s}
      #${id} .gbtn:hover{transform:translateY(-1px)}
      #${id} .gbtn:active{transform:none}
      #${id} .gbtn.gold{color:#2a1c06;border:1px solid #ffe7a8;background:linear-gradient(135deg,#f6cf6a,#e7b34a 55%,#c98f2e);
        box-shadow:0 8px 26px rgba(255,180,60,.22),inset 0 1px 0 rgba(255,255,255,.55)}
      #${id} .gbtn.gold:hover{filter:brightness(1.06);box-shadow:0 10px 34px rgba(255,190,70,.4),inset 0 1px 0 rgba(255,255,255,.55)}
      #${id} .gbtn.ghost{color:#e8dcc0;background:rgba(18,15,10,.6);border:1px solid rgba(255,216,138,.3)}
      #${id} .gbtn.ghost:hover{border-color:rgba(255,216,138,.7)}
      #${id} .gbtn.dim{color:#a99a78;background:transparent;border:1px solid rgba(255,216,138,.18);font-size:12px;padding:9px;letter-spacing:1px}
      #${id} .gbtn:disabled{opacity:.55;cursor:default;transform:none}
      #${id} .gerr{background:rgba(160,40,40,.18);border:1px solid rgba(255,110,110,.4);border-radius:8px;
        padding:9px 12px;font-size:12px;color:#ffb4a8;margin-top:10px;display:none;font-family:'Segoe UI',sans-serif}
      #${id} .gok{background:rgba(60,140,80,.16);border:1px solid rgba(120,230,150,.35);border-radius:8px;
        padding:9px 12px;font-size:12px;color:#a8e6b8;margin-top:10px;display:none;font-family:'Segoe UI',sans-serif}
      #${id} .gnote{font-size:11px;line-height:1.5;color:#9c8e6e;font-family:'Segoe UI',sans-serif}
      #${id} .glink{color:#ffd98a;cursor:pointer;text-decoration:underline}
      #${id} .gsect{font-size:10.5px;letter-spacing:2px;color:#ffd98a;text-transform:uppercase;margin:15px 0 8px;
        border-bottom:1px solid rgba(255,216,138,.18);padding-bottom:4px}
    </style>
    <div id="${id}">
      <div class="gbg"></div><div class="gvig"></div>
      ${inner}
    </div>
  `;
}
