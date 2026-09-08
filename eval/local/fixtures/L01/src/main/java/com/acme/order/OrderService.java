package com.acme.order;
import java.util.*;
import java.util.concurrent.atomic.AtomicLong;
public final class OrderService {
  private final Map<String, Reservation> reservations = new HashMap<>();
  private final AtomicLong sequence = new AtomicLong();
  public Reservation reserve(String orderId, int amount) {
    Reservation old = reservations.get(orderId);
    if (old != null) return old;
    Reservation created = new Reservation(orderId, amount, sequence.incrementAndGet());
    Thread.yield();
    reservations.put(orderId, created);
    return created;
  }
  public int size() { return reservations.size(); }
}
