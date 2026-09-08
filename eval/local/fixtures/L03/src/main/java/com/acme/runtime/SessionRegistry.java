package com.acme.runtime;
import java.util.concurrent.*;
public final class SessionRegistry {
 private final ConcurrentMap<String,Session> sessions=new ConcurrentHashMap<>();
 public void put(Session s){sessions.put(s.id(),s);}
 public Session get(String id){return sessions.get(id);}
 public void remove(String id){sessions.remove(id);}
 public int size(){return sessions.size();}
}
