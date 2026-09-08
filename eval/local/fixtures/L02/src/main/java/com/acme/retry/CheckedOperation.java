package com.acme.retry;
@FunctionalInterface public interface CheckedOperation<T> { T run() throws Exception; }
