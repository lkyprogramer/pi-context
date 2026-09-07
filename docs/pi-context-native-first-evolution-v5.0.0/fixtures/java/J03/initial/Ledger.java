public final class Ledger {
    public int accounts;
    public int journal;
    public boolean failAfterDebit;
    public void transfer(int amount) {
        accounts -= amount;
        journal += 1;
        if (failAfterDebit) throw new IllegalStateException("boom");
    }
}
