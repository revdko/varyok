// Var Yok — oyun çekirdeği. Hem sunucuda (Node) hem tarayıcıda kullanılır.
(function(root){
  // Kart: {id, suit 0..3 (♠♥♦♣), rank 1..13}. idx = suit*13 + rank-1. Okey kartları "W" (joker).
  function meldOptions(i, counts, w){
    const suit = Math.floor(i/13), rank = i%13 + 1, out = [];
    const os = [];
    for(let s=0;s<4;s++) if(s!==suit && counts[s*13+rank-1]>0) os.push(s*13+rank-1);
    for(let mask=0; mask<(1<<os.length); mask++){
      const items = os.filter((_,k)=>(mask>>k)&1);
      for(let j=0;j<=w;j++){
        const size = 1+items.length+j;
        if(size>=3 && size<=4) out.push({items, j, slots:[i,...items,...Array(j).fill('W')]});
      }
    }
    const ps = rank===1 ? [1,14] : [rank];
    for(const p of ps) for(let L=3; L<=5; L++) for(let s=p-L+1; s<=p; s++){
      if(s<1 || s+L-1>14) continue;
      const items=[], slots=[]; let j=0;
      for(let q=s;q<s+L;q++){
        if(q===p){ slots.push(i); continue; }
        const r = q===14 ? 1 : q, idx = suit*13 + r-1;
        if(counts[idx]>0){ items.push(idx); slots.push(idx); } else { j++; slots.push('W'); }
      }
      if(j<=w && j<L-1) out.push({items, j, slots});
    }
    return out;
  }
  const memoA = new Map();
  function allMeld(counts, w){
    const i = counts.findIndex(x=>x>0);
    if(i<0) return w===0 ? [] : null;
    const key = counts.join('')+'|'+w;
    if(memoA.has(key)) return memoA.get(key);
    counts[i]--;
    let res = null;
    for(const o of meldOptions(i,counts,w)){
      o.items.forEach(x=>counts[x]--);
      const r = allMeld(counts, w-o.j);
      o.items.forEach(x=>counts[x]++);
      if(r){ res = [o.slots, ...r]; break; }
    }
    counts[i]++;
    if(memoA.size>200000) memoA.clear();
    memoA.set(key,res);
    return res;
  }
  // El değerlendirmesi: per = kart başı 10, ikili (çift/ardışık) = 3-4, boşta okey = 6
  const memoG = new Map();
  function gSolve(counts, w){
    const key = counts.join('')+'|'+w;
    const m = memoG.get(key); if(m) return m;
    const i = counts.findIndex(x=>x>0);
    if(i<0){ const b={v:w*6, groups:[]}; memoG.set(key,b); return b; }
    const suit = Math.floor(i/13), rank = i%13+1;
    counts[i]--;
    let r = gSolve(counts,w);
    let best = {v:r.v, groups:r.groups};
    for(const o of meldOptions(i,counts,w)){
      o.items.forEach(x=>counts[x]--);
      r = gSolve(counts, w-o.j);
      o.items.forEach(x=>counts[x]++);
      const v = r.v + 10*o.slots.length;
      if(v>best.v) best = {v, groups:[{type:'meld', slots:o.slots}, ...r.groups]};
    }
    const partners = new Map();
    for(let s=0;s<4;s++){ const idx=s*13+rank-1; if(s!==suit && counts[idx]>0) partners.set(idx,4); }
    for(const p of (rank===1?[1,14]:[rank])) for(const d of [1,2]){
      const q=p+d; if(q>14) continue;
      const idx = suit*13 + (q===14?1:q) - 1;
      if(counts[idx]>0 && !partners.has(idx)) partners.set(idx, d===1?4:3);
    }
    for(const [idx,val] of partners){
      counts[idx]--;
      r = gSolve(counts,w);
      counts[idx]++;
      if(r.v+val>best.v) best = {v:r.v+val, groups:[{type:'pair', slots:[i,idx]}, ...r.groups]};
    }
    counts[i]++;
    if(memoG.size>300000) memoG.clear();
    memoG.set(key,best);
    return best;
  }
  const isWild = (c, okeySuit) => c.rank===1 && c.suit===okeySuit;
  function toCW(cards, okeySuit){
    const counts = new Array(52).fill(0); let w=0;
    for(const c of cards){ if(isWild(c,okeySuit)) w++; else counts[c.suit*13+c.rank-1]++; }
    return [counts,w];
  }
  function canOpen(cards, okeySuit){ const [c,w]=toCW(cards,okeySuit); return allMeld(c,w); }
  function handValue(cards, okeySuit){ const [c,w]=toCW(cards,okeySuit); return gSolve(c,w); }

  // Solver çıktısındaki slotları gerçek kartlara eşler
  function mapSlots(groups, cards, okeySuit){
    const pool=[...cards], out=[];
    const take = s => {
      const k = pool.findIndex(c => s==='W' ? isWild(c,okeySuit) : (!isWild(c,okeySuit) && c.suit*13+c.rank-1===s));
      return k>=0 ? pool.splice(k,1)[0] : null;
    };
    for(const g of groups) out.push(g.map(take).filter(Boolean));
    return {groups:out, rest:pool};
  }

  // Elde yan yana duran kartlar geçerli bir per mi? (sıralı seri ya da aynı sayı)
  function isPer(cards, okeySuit){
    if(cards.length<3) return false;
    const W = c => isWild(c,okeySuit);
    const nat = cards.filter(c=>!W(c));
    if(nat.length===0) return false;
    if(cards.length<=4 && nat.every(c=>c.rank===nat[0].rank) && new Set(nat.map(c=>c.suit)).size===nat.length) return true;
    if(!nat.every(c=>c.suit===nat[0].suit)) return false;
    const fits = seq => {
      for(let s=1; s+seq.length-1<=14; s++){
        if(seq.every((c,k)=> W(c) || c.rank===((s+k)===14?1:s+k))) return true;
      }
      return false;
    };
    return fits(cards) || fits([...cards].reverse());
  }
  function findPerSegments(hand, okeySuit){
    const segs=[]; let loose=[]; let i=0;
    while(i<hand.length){
      let end=-1;
      for(let j=hand.length; j>=i+3; j--){ if(isPer(hand.slice(i,j), okeySuit)){ end=j; break; } }
      if(end>0){
        if(loose.length){ segs.push({per:false, cards:loose}); loose=[]; }
        segs.push({per:true, cards:hand.slice(i,end)}); i=end;
      } else { loose.push(hand[i]); i++; }
    }
    if(loose.length) segs.push({per:false, cards:loose});
    return segs;
  }

  const api = {canOpen, handValue, mapSlots, isPer, findPerSegments, isWild,
    clearMemo(){ memoA.clear(); memoG.clear(); }};
  if(typeof module!=='undefined' && module.exports) module.exports = api;
  else root.VarYokCore = api;
})(typeof window!=='undefined' ? window : globalThis);
