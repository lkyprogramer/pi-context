package com.acme.runtime;
public record Session(String id, long lastHeartbeatMillis, boolean connected) {
 public Session withHeartbeat(long t){return new Session(id,t,connected);}
 public Session withConnected(boolean c){return new Session(id,lastHeartbeatMillis,c);}
}
