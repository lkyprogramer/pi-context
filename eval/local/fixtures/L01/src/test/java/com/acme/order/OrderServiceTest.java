package com.acme.order;
import java.util.*; import java.util.concurrent.*;
public final class OrderServiceTest {
 public static void main(String[] args) throws Exception {
  for (int round=0; round<40; round++) {
   OrderService s=new OrderService(); ExecutorService ex=Executors.newFixedThreadPool(16);
   CountDownLatch start=new CountDownLatch(1); List<Future<Reservation>> fs=new ArrayList<>();
   for(int i=0;i<32;i++) fs.add(ex.submit(()->{start.await(); return s.reserve("ORD-7",99);}));
   start.countDown(); Set<Long> seq=new HashSet<>(); for(Future<Reservation> f:fs) seq.add(f.get().sequence());
   ex.shutdown(); if(seq.size()!=1 || s.size()!=1) throw new AssertionError("idempotency broken: seq="+seq+" size="+s.size());
  }
  System.out.println("PASS OrderServiceTest");
 }
}
