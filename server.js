// Var Yok — çevrimiçi oyun sunucusu. Sayfaları sunar, odaları ve oyun kurallarını yönetir.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
// Dosyalar public/ klasöründe de olabilir, ana klasörde de.
const PUB = fs.existsSync(path.join(__dirname, 'public', 'index.html')) ? path.join(__dirname, 'public') : __dirname;
const Core = require(path.join(PUB, 'core.js'));
const SERVED = new Set(['/index.html', '/core.js', '/tek.html']);

const PORT = process.env.PORT || 10000;
const START_SCORE = 100, BASE_STAKE = 10, MAX_PLAYERS = 6, MIN_PLAYERS = 3;
const BOT_NAMES = ['Ayşe','Mehmet','Zeynep','Can','Elif','Kemal'];
const SUITS = ['♠','♥','♦','♣'];
const RL = r => ({1:'A',11:'J',12:'Q',13:'K'}[r] || String(r));
const cardName = c => RL(c.rank)+SUITS[c.suit];

// ---------- statik dosyalar ----------
const TYPES = {'.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.svg':'image/svg+xml'};
const server = http.createServer((req, res) => {
  let p = decodeURIComponent((req.url || '/').split('?')[0]);
  if (p === '/' ) p = '/index.html';
  if (p === '/saglik') { res.writeHead(200); res.end('ok'); return; }
  if (!SERVED.has(p)) { res.writeHead(404, {'Content-Type':'text/plain; charset=utf-8'}); res.end('Bulunamadı'); return; }
  const file = path.join(PUB, p);
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, {'Content-Type':'text/plain; charset=utf-8'}); res.end('Bulunamadı'); return; }
    res.writeHead(200, {'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control':'no-cache'});
    res.end(data);
  });
});

// ---------- odalar ----------
const rooms = new Map();
function newCode(){
  const A='ABCDEFGHJKLMNPRSTUVYZ23456789';
  let c; do { c = Array.from({length:5}, ()=>A[crypto.randomInt(A.length)]).join(''); } while(rooms.has(c));
  return c;
}
const shuffle = a => { for(let i=a.length-1;i>0;i--){ const j=crypto.randomInt(i+1); [a[i],a[j]]=[a[j],a[i]]; } return a; };

class Room {
  constructor(code){
    this.code = code; this.players = []; this.phase = 'lobby'; this.log = [];
    this.timer = null; this.handNo = 0; this.stake = BASE_STAKE; this.result = null;
    this.lastActive = Date.now();
  }
  get host(){ return this.players.find(p=>!p.bot && !p.left); }
  addLog(m){ this.log.unshift(m); this.log = this.log.slice(0,6); }
  inPlay(p){ return p.bid!=='yok' && p.bid!=='out'; }
  autoPlays(p){ return p.bot || !p.connected; }
  seatsAfter(d){ const s=[]; const n=this.players.length; for(let k=1;k<=n;k++){ const i=(d+k)%n; if(!this.players[i].out) s.push(i); } return s; }
  schedule(fn, ms){ clearTimeout(this.timer); this.timer = setTimeout(()=>{ this.timer=null; try{ fn(); }catch(e){ console.error(e); } }, ms); }

  addPlayer(name, bot, token){
    const used = new Set(this.players.map(p=>p.name));
    if(bot){ name = BOT_NAMES.find(n=>!used.has(n)) || ('Bot '+(this.players.length+1)); }
    else { name = (name||'Oyuncu').trim().slice(0,16) || 'Oyuncu'; let base=name, k=2; while(used.has(name)) name = base+' '+(k++); }
    const p = {id: crypto.randomUUID(), token: token || crypto.randomUUID(), name, bot, connected: !bot, ws:null,
      score: START_SCORE, out:false, hand:[], bid:null, katla:false, thresh: 26 + crypto.randomInt(10)};
    this.players.push(p);
    return p;
  }

  startGame(){
    this.players.forEach(p=>{ p.score=START_SCORE; p.out=false; });
    this.dealer = crypto.randomInt(this.players.length);
    this.handNo = 0;
    this.newHand();
  }

  newHand(carry){
    Core.clearMemo();
    this.handNo++;
    const deck=[]; let id=0;
    for(let d=0;d<2;d++) for(let s=0;s<4;s++) for(let r=1;r<=13;r++) deck.push({id:id++, suit:s, rank:r});
    shuffle(deck);
    this.players.forEach(p=>{ p.hand=[]; p.bid = p.out ? 'out' : null; p.katla=false; });
    this.stake = BASE_STAKE;
    const seats = this.seatsAfter(this.dealer);
    for(let round=0; round<5; round++) for(const i of seats) this.players[i].hand.push(deck.pop(), deck.pop());
    this.deck = deck;
    this.indicator = deck.pop();
    this.okeySuit = this.indicator.suit;
    this.discard = [];
    this.forced = seats[0];
    this.players[this.forced].bid = 'zorunlu';
    this.bidders = seats; this.bidPos = 0;
    this.phase = 'bid'; this.turn = null; this.step = null; this.result = null;
    this.log = [];
    if(carry) this.addLog(carry);
    this.addLog(`${this.handNo}. el: ${this.players[this.dealer].name} dağıttı. Gösterge ${cardName(this.indicator)}, okey A${SUITS[this.okeySuit]}.`);
    this.advance();
  }

  // Oyunu bir sonraki karar noktasına kadar ilerletir. İnsan oyuncuyu bekler, botları zamanlayarak oynatır.
  advance(){
    this.broadcast();
    if(this.phase==='bid'){
      if(this.bidPos>=this.bidders.length){ this.startPlay(); return; }
      const p = this.players[this.bidders[this.bidPos]];
      if(!this.autoPlays(p)) return;
      this.schedule(()=>{ this.botBid(p); this.bidPos++; this.advance(); }, 900);
    } else if(this.phase==='play'){
      if(this.deck.length===0){
        this.phase='closing';
        this.addLog('Deste bitti, kimse açamadı. El kapandı, yeni el dağıtılıyor.');
        this.broadcast();
        this.schedule(()=>{ this.dealer=this.seatsAfter(this.dealer)[0]; this.newHand('Önceki elde deste bitti, kimse açamadı.'); }, 2500);
        return;
      }
      const p = this.players[this.turn];
      if(!this.autoPlays(p)) return;
      this.schedule(()=>{ const won=this.botTurn(this.turn); if(won) this.endHand(this.turn); else { this.nextTurn(); this.advance(); } }, 1000);
    }
  }

  katla(p){ this.stake*=2; p.katla=true; if(p.bid!=='zorunlu') p.bid='var'; this.addLog(`${p.name}: Katladım! El artık ${this.stake} puan.`); }

  botBid(p){
    const v = Core.handValue(p.hand, this.okeySuit).v;
    const strong = v >= p.thresh + 10;
    const isForced = this.players.indexOf(p)===this.forced;
    if(isForced){ if(strong) this.katla(p); else this.addLog(`${p.name}: zorunlu oynuyor, katlamadı.`); }
    else {
      p.bid = (v>=p.thresh || Math.random()<0.08) ? 'var' : 'yok';
      if(p.bid==='var' && strong) this.katla(p); else this.addLog(`${p.name}: ${p.bid==='var'?'Varım':'Yokum'}`);
    }
  }

  startPlay(){
    const active = this.players.filter(p=>this.inPlay(p));
    if(active.length<2){
      this.phase='closing';
      this.addLog('Herkes yokum dedi. El bitti, yeni el dağıtılıyor.');
      this.broadcast();
      this.schedule(()=>{ this.dealer=this.seatsAfter(this.dealer)[0]; this.newHand('Önceki elde herkes yokum dedi.'); }, 2500);
      return;
    }
    this.phase='play'; this.turn=this.forced; this.step='draw';
    this.addLog(`${this.players[this.forced].name} başlıyor. Oyunda ${active.length} kişi var.`);
    this.advance();
  }

  nextTurn(){
    let t=this.turn; const n=this.players.length;
    do { t=(t+1)%n; } while(!this.inPlay(this.players[t]));
    this.turn=t; this.step='draw';
  }

  botTurn(i){
    const pl=this.players[i], os=this.okeySuit, W=c=>Core.isWild(c,os);
    const top=this.discard[this.discard.length-1];
    const bestDiscard = h => {
      let best=null;
      for(const c of h){
        if(W(c)) continue;
        const rest=h.filter(x=>x!==c);
        if(Core.canOpen(rest,os)) return {c, win:true, v:1e9};
        const v=Core.handValue(rest,os).v + Math.random()*0.5;
        if(!best || v>best.v) best={c,v,win:false};
      }
      return best || {c:h[0], v:0, win:false};
    };
    let took=false;
    if(top){
      const b=bestDiscard([...pl.hand, top]);
      const v0=Core.handValue(pl.hand,os).v;
      if(b.win || (b.c!==top && b.v>v0+5)) took=true;
    }
    const drawn = took ? this.discard.pop() : this.deck.pop();
    if(took) this.addLog(`${pl.name} yerden ${cardName(drawn)} aldı.`);
    pl.hand.push(drawn);
    const b=bestDiscard(pl.hand);
    pl.hand=pl.hand.filter(x=>x!==b.c);
    this.discard.push(b.c);
    if(b.win){ this.addLog(`${pl.name} ${cardName(b.c)} atıp açtı!`); return true; }
    this.addLog(`${pl.name} ${took?'':'desteden çekti, '}${cardName(b.c)} attı.`);
    return false;
  }

  endHand(winner){
    const s=this.stake, res={winner, stake:s, deltas:{}, eliminated:[]};
    const others=this.players.map((p,i)=>i).filter(i=>i!==winner && this.inPlay(this.players[i]));
    others.forEach(i=>{ this.players[i].score-=s; res.deltas[i]=-s; });
    this.players[winner].score += s*others.length; res.deltas[winner]=s*others.length;
    const wp=this.players[winner];
    const melds = Core.canOpen(wp.hand, this.okeySuit) || [];
    res.melds = Core.mapSlots(melds, wp.hand, this.okeySuit).groups;
    res.bids = this.players.map(p=>p.bid);
    this.players.forEach((p,i)=>{ if(!p.out && p.score<=0){ p.out=true; res.eliminated.push(i); this.addLog(`${p.name} puanı bitti, oyundan elendi.`); } });
    const alive=this.players.filter(p=>!p.out);
    const aliveHumans=alive.filter(p=>!p.bot);
    if(alive.length<=1 || aliveHumans.length===0){
      this.phase='gameOver';
      const champ = alive.slice().sort((a,b)=>b.score-a.score)[0];
      res.gameOver = champ ? `${champ.name} oyunu kazandı!` : 'Oyun bitti.';
    } else {
      this.phase='handEnd';
      res.nextAt = Date.now()+15000;
      this.schedule(()=>this.nextHand(), 15000);
    }
    this.result=res;
    this.broadcast();
  }
  nextHand(){ if(this.phase!=='handEnd') return; this.dealer=this.seatsAfter(this.dealer)[0]; this.newHand(); }

  // ---------- insan oyuncu hamleleri ----------
  act(p, m){
    const i=this.players.indexOf(p);
    const err = msg => p.ws && send(p.ws, {t:'error', msg});
    switch(m.t){
      case 'addBot':
        if(this.phase!=='lobby' || p!==this.host) return;
        if(this.players.length>=MAX_PLAYERS) return err('Masa dolu (en fazla 6 kişi).');
        this.addPlayer(null, true); return this.broadcast();
      case 'removeBot': {
        if(this.phase!=='lobby' || p!==this.host) return;
        const k=this.players.findIndex(x=>x.id===m.id && x.bot);
        if(k>=0) this.players.splice(k,1);
        return this.broadcast();
      }
      case 'start':
        if(this.phase!=='lobby' || p!==this.host) return;
        if(this.players.length<MIN_PLAYERS) return err('En az 3 kişi gerekiyor. Arkadaşlarını davet et ya da bilgisayar oyuncu ekle.');
        return this.startGame();
      case 'again':
        if(this.phase!=='gameOver' || p!==this.host) return;
        this.players = this.players.filter(x=>x.bot || x.connected);
        this.phase='lobby'; this.result=null; this.log=[];
        return this.broadcast();
      case 'next':
        if(this.phase!=='handEnd' || p!==this.host) return;
        return this.nextHand();
      case 'bid': {
        if(this.phase!=='bid' || this.bidders[this.bidPos]!==i) return;
        const c=m.choice;
        if(p.bid==='zorunlu'){ if(c==='katla') this.katla(p); else this.addLog(`${p.name}: katlamadan oynuyor.`); }
        else if(c==='katla') this.katla(p);
        else if(c==='var'||c==='yok'){ p.bid=c; this.addLog(`${p.name}: ${c==='var'?'Varım':'Yokum'}`); }
        else return;
        this.bidPos++; return this.advance();
      }
      case 'draw': {
        if(this.phase!=='play' || this.turn!==i || this.step!=='draw') return;
        let c;
        if(m.from==='discard'){ if(!this.discard.length) return; c=this.discard.pop(); this.addLog(`${p.name} yerden ${cardName(c)} aldı.`); }
        else { if(!this.deck.length) return; c=this.deck.pop(); }
        p.hand.push(c); this.step='discard';
        if(p.ws) send(p.ws, {t:'drawn', id:c.id});
        return this.broadcast();
      }
      case 'discard': case 'open': {
        if(this.phase!=='play' || this.turn!==i || this.step!=='discard') return;
        const c=p.hand.find(x=>x.id===m.id); if(!c) return;
        const rest=p.hand.filter(x=>x!==c);
        if(m.t==='open'){
          if(!Core.canOpen(rest,this.okeySuit)) return err(`${cardName(c)} atınca kalan 10 kart tam per olmuyor.`);
          p.hand=rest; this.discard.push(c);
          this.addLog(`${p.name} ${cardName(c)} atıp açtı!`);
          return this.endHand(i);
        }
        p.hand=rest; this.discard.push(c);
        this.addLog(`${p.name} ${cardName(c)} attı.`);
        this.nextTurn(); return this.advance();
      }
    }
  }

  // ---------- durum gönderimi (her oyuncu sadece kendi elini görür) ----------
  viewFor(p){
    const me=this.players.indexOf(p);
    return {
      code:this.code, phase:this.phase, me, hostId:this.host && this.host.id, handNo:this.handNo,
      players:this.players.map(x=>({id:x.id, name:x.name, bot:x.bot, connected:x.connected, score:x.score, out:x.out, bid:x.bid, katla:x.katla, count:x.hand.length})),
      hand: p.hand,
      dealer:this.dealer, forced:this.forced, stake:this.stake,
      indicator:this.indicator, okeySuit:this.okeySuit,
      top:this.discard ? this.discard[this.discard.length-1] || null : null,
      deckCount:this.deck ? this.deck.length : 0,
      turn:this.turn, step:this.step,
      bidder: this.phase==='bid' ? this.bidders[this.bidPos] : null,
      log:this.log, result:this.result, minPlayers:MIN_PLAYERS, maxPlayers:MAX_PLAYERS,
    };
  }
  broadcast(){
    this.lastActive=Date.now();
    for(const p of this.players) if(p.ws && p.connected) send(p.ws, {t:'state', s:this.viewFor(p)});
  }
}

function send(ws, obj){ try{ if(ws.readyState===1) ws.send(JSON.stringify(obj)); }catch(e){} }

// ---------- websocket ----------
const wss = new WebSocketServer({ server });
wss.on('connection', ws => {
  ws.alive = true;
  ws.on('pong', ()=>{ ws.alive=true; });
  ws.on('message', raw => {
    let m; try{ m=JSON.parse(raw); }catch(e){ return; }
    if(m.t==='create' || m.t==='join'){
      let room;
      if(m.t==='create'){ room=new Room(newCode()); rooms.set(room.code, room); }
      else {
        room=rooms.get(String(m.code||'').toUpperCase().trim());
        if(!room) return send(ws, {t:'error', msg:'Bu kodla bir oda bulunamadı. Kodu kontrol et.', fatal:true});
      }
      let p = m.token && room.players.find(x=>x.token===m.token && !x.bot);
      if(!p){
        if(room.phase!=='lobby') return send(ws, {t:'error', msg:'Bu masada oyun başladı. Yeni oyuncu katılamaz.', fatal:true});
        if(room.players.length>=MAX_PLAYERS) return send(ws, {t:'error', msg:'Masa dolu (en fazla 6 kişi).', fatal:true});
        p = room.addPlayer(m.name, false, m.token);
        room.addLog(`${p.name} masaya oturdu.`);
      } else {
        if(p.ws && p.ws!==ws) try{ p.ws.close(); }catch(e){}
        if(!p.connected) room.addLog(`${p.name} geri döndü.`);
      }
      p.ws=ws; p.connected=true; ws.room=room; ws.player=p;
      send(ws, {t:'joined', code:room.code, token:p.token});
      room.broadcast();
      return;
    }
    if(ws.room && ws.player) ws.room.act(ws.player, m);
  });
  ws.on('close', () => {
    const room=ws.room, p=ws.player;
    if(!room || !p || p.ws!==ws) return;
    p.connected=false; p.ws=null;
    if(room.phase==='lobby'){ room.players.splice(room.players.indexOf(p),1); room.addLog(`${p.name} masadan kalktı.`); room.broadcast(); }
    else {
      room.addLog(`${p.name} bağlantısı koptu, yerine bilgisayar oynuyor.`);
      room.advance();
    }
  });
});
// Kopan bağlantıları yakala, boş odaları temizle
setInterval(()=>{
  wss.clients.forEach(ws=>{ if(!ws.alive) return ws.terminate(); ws.alive=false; try{ ws.ping(); }catch(e){} });
  const now=Date.now();
  for(const [code,room] of rooms){
    const anyone=room.players.some(p=>!p.bot && p.connected);
    if(!anyone && now-room.lastActive>15*60*1000){ clearTimeout(room.timer); rooms.delete(code); }
  }
}, 30000);

server.listen(PORT, ()=>console.log(`Var Yok sunucusu ${PORT} portunda çalışıyor`));
