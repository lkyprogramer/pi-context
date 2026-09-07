public final class Oracle {
    private static void check(boolean ok, String message) {
        if (!ok) throw new AssertionError(message);
    }
    public static void main(String[] args) {
        Deduplicator d = new Deduplicator();
        check(d.claim("A", "event-1"), "first claim must succeed");
        check(d.claim("B", "event-1"), "same eventId from another tenant must succeed");
        check(!d.claim("A", "event-1"), "duplicate tenant/eventId must fail");
        check(d.claim("a:b", "c"), "first separator pair");
        check(d.claim("a", "b:c"), "separator collision must not merge tenants");
        check(new Deduplicator().claim("A", "event-1"), "instances must not share global state");
        boolean rejected=false;
        try { d.claim(null, "event-1"); } catch (IllegalArgumentException expected) { rejected=true; }
        check(rejected, "null tenant must be rejected");
        System.out.println("ORACLE_PASS:J01");
    }
}
