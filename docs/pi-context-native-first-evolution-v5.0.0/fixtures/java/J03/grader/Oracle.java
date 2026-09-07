public final class Oracle {
    private static void check(boolean ok, String message) {
        if (!ok) throw new AssertionError(message);
    }
    public static void main(String[] args) {
        Ledger ok = new Ledger();
        ok.transfer(3);
        check(ok.accounts == -3 && ok.journal == 1, "success path must commit both sides");
        Ledger fail = new Ledger();
        fail.failAfterDebit = true;
        boolean threw = false;
        try { fail.transfer(3); } catch (IllegalStateException e) { threw = true; }
        check(threw, "failure must surface");
        check(fail.accounts == 0 && fail.journal == 0, "failure must roll back both sides");
        System.out.println("ORACLE_PASS:J03");
    }
}
