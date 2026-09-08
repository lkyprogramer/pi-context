package com.acme.retry;
public record RetryPolicy(int maxAttempts) { public RetryPolicy { if(maxAttempts<1) throw new IllegalArgumentException(); } }
