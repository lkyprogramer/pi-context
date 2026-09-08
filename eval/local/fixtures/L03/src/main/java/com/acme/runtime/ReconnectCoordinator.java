package com.acme.runtime;
public final class ReconnectCoordinator {
 private final SessionRegistry registry; private final HeartbeatPolicy heartbeat;
 public ReconnectCoordinator(SessionRegistry registry, HeartbeatPolicy heartbeat){this.registry=registry;this.heartbeat=heartbeat;}
 public Session reconnect(String id,long nowMillis){
   Session s=registry.get(id);
   if(s==null) { s=new Session(id,nowMillis,true); registry.put(s); return s; }
   if(heartbeat.expired(s,nowMillis)) { registry.remove(id); return new Session(id,nowMillis,true); }
   Session connected=s.withConnected(true).withHeartbeat(nowMillis); registry.put(connected); return connected;
 }
}
