package com.acme.retry;
import java.io.IOException; import java.util.concurrent.atomic.AtomicInteger;
public final class RetryingClientTest {
 public static void main(String[] a) throws Exception {
  AtomicInteger c=new AtomicInteger(); RetryingClient x=new RetryingClient(new RetryPolicy(3));
  String v=x.execute(()->{ if(c.incrementAndGet()<3) throw new IOException("transient"); return "OK";});
  if(!"OK".equals(v)||c.get()!=3) throw new AssertionError("success path attempts="+c);
  AtomicInteger f=new AtomicInteger(); IOException marker=new IOException("terminal");
  try { x.execute(()->{f.incrementAndGet(); throw marker;}); throw new AssertionError("expected failure"); }
  catch(IOException e) { if(e!=marker) throw new AssertionError("must rethrow last cause"); }
  if(f.get()!=3) throw new AssertionError("maxAttempts means total calls; got "+f);
  System.out.println("PASS RetryingClientTest");
 }
}
