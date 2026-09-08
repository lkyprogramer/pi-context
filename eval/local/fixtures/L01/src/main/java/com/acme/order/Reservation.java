package com.acme.order;
public record Reservation(String orderId, int amount, long sequence) {}
