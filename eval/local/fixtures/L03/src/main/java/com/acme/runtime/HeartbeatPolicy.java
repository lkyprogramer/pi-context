package com.acme.runtime;
public final class HeartbeatPolicy {
 private final long timeoutMillis; public HeartbeatPolicy(long timeoutMillis){this.timeoutMillis=timeoutMillis;}
 public boolean expired(Session s,long nowMillis){ return (nowMillis/1000 - s.lastHeartbeatMillis()) > timeoutMillis; }
}
