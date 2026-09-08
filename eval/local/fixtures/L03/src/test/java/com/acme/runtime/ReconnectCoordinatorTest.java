package com.acme.runtime;
public final class ReconnectCoordinatorTest {
 public static void main(String[] args){
  SessionRegistry r=new SessionRegistry(); HeartbeatPolicy p=new HeartbeatPolicy(5_000); ReconnectCoordinator c=new ReconnectCoordinator(r,p);
  r.put(new Session("S1",1_000_000L,false));
  Session a=c.reconnect("S1",1_003_000L);
  if(!a.connected()||a.lastHeartbeatMillis()!=1_003_000L||r.size()!=1) throw new AssertionError("normal reconnect failed");
  r.put(new Session("S2",2_000_000L,false));
  if(!p.expired(r.get("S2"),2_006_001L)) throw new AssertionError("heartbeat timeout must be measured in milliseconds");
  Session b=c.reconnect("S2",2_006_001L);
  if(!b.connected()||b.lastHeartbeatMillis()!=2_006_001L) throw new AssertionError("expired reconnect result wrong");
  if(r.get("S2")!=b || r.size()!=2) throw new AssertionError("reconnected session must remain registered");
  System.out.println("PASS ReconnectCoordinatorTest");
 }
}
