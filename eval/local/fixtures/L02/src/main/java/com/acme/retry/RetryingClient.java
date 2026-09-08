package com.acme.retry;
public final class RetryingClient {
 private final RetryPolicy policy; public RetryingClient(RetryPolicy p){this.policy=p;}
 public <T> T execute(CheckedOperation<T> op) throws Exception {
   Exception last=null;
   for(int attempt=0; attempt<=policy.maxAttempts(); attempt++) {
     try { return op.run(); } catch(Exception e) { last=e; }
   }
   throw new IllegalStateException("retry exhausted", last);
 }
}
