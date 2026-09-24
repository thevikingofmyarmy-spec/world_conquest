const http=require("http");
const fs=require("fs");
const path=require("path");
const WebSocket=require("ws");

const PORT=process.env.PORT||3000;
const MAX_PLAYERS=40;
const START_DAY=30;
const TICK_MS=5000;

const server=http.createServer((req,res)=>{
  const requested=req.url==="/"?"index.html":req.url.replace(/^\/+/,"");
  const full=path.join(__dirname,requested);
  if(!full.startsWith(__dirname)||!fs.existsSync(full)||fs.statSync(full).isDirectory()){
    res.writeHead(404);return res.end("Not found");
  }
  const types={".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".css":"text/css; charset=utf-8"};
  res.writeHead(200,{"Content-Type":types[path.extname(full)]||"application/octet-stream"});
  fs.createReadStream(full).pipe(res);
});

const wss=new WebSocket.Server({server});
const lobbies=new Map();
let lobbyCounter=0;

function newLobby(){
  const id=String(++lobbyCounter).padStart(3,"0");
  const lobby={id,players:new Map(),day:START_DAY};
  lobbies.set(id,lobby);
  return lobby;
}
function getOpenLobby(){
  for(const lobby of lobbies.values()) if(lobby.players.size<MAX_PLAYERS)return lobby;
  return newLobby();
}
function send(ws,obj){if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify(obj))}
function broadcast(lobby,obj){for(const p of lobby.players.values())send(p.ws,obj)}

wss.on("connection",ws=>{
  let player=null;

  ws.on("message",raw=>{
    let m;try{m=JSON.parse(raw)}catch{return}

    if(m.type==="JOIN_QUEUE"){
      const name=String(m.name||"").trim().slice(0,20);
      if(name.length<2)return send(ws,{type:"ERROR",message:"Invalid player name."});

      for(const lobby of lobbies.values())
        for(const p of lobby.players.values())
          if(p.name.toLowerCase()===name.toLowerCase())
            return send(ws,{type:"ERROR",message:"That player name is already in use."});

      const lobby=getOpenLobby();
      const id=Math.random().toString(36).slice(2,10);
      player={id,name,country:null,lobby,ws};
      lobby.players.set(id,player);

      send(ws,{type:"QUEUE",lobbyId:lobby.id,count:lobby.players.size});
      send(ws,{type:"LOBBY_ASSIGNED",lobbyId:lobby.id,count:lobby.players.size});
    }

    else if(m.type==="SELECT_COUNTRY"){
      if(!player)return;
      const country=String(m.country||"").trim();
      const taken=[...player.lobby.players.values()].some(p=>p!==player&&p.country===country);
      if(taken)return send(ws,{type:"COUNTRY_TAKEN"});
      player.country=country;
      send(ws,{type:"COUNTRY_CONFIRMED",country});
    }

    else if(m.type==="JUSTIFY_WAR"){
      if(!player?.country)return;
      if(player.lobby.day>0)return send(ws,{type:"ERROR",message:"War justification is locked until DAY 0."});
      const target=[...player.lobby.players.values()].find(p=>p.country===m.targetCountry);
      if(!target)return send(ws,{type:"ERROR",message:"Target player/country not found."});
      const notice={type:"WAR_JUSTIFIED",attacker:player.name,attackerCountry:player.country,defender:target.name,defenderCountry:target.country,targetPlayer:target.name};
      broadcast(player.lobby,notice);
    }

    else if(m.type==="DECLARE_WAR"){
      if(!player?.country)return;
      if(player.lobby.day>0)return send(ws,{type:"ERROR",message:"War declarations are locked until DAY 0."});
      const target=[...player.lobby.players.values()].find(p=>p.country===m.targetCountry);
      if(!target)return send(ws,{type:"ERROR",message:"Target player/country not found."});
      const notice={type:"WAR_DECLARED",attacker:player.name,attackerCountry:player.country,defender:target.name,defenderCountry:target.country,targetPlayer:target.name};
      broadcast(player.lobby,notice);
    }
  });

  ws.on("close",()=>{
    if(player?.lobby)player.lobby.players.delete(player.id);
  });
});

setInterval(()=>{
  for(const lobby of lobbies.values()){
    if(lobby.players.size===0)continue;
    if(lobby.day>0)lobby.day--;
    broadcast(lobby,{type:"DAY_UPDATE",day:lobby.day});
  }
},TICK_MS);

server.listen(PORT,()=>console.log("World Strategy server listening on port "+PORT));