public final class Oracle {
    private static void check(boolean ok, String message) {
        if (!ok) throw new AssertionError(message);
    }
    public static void main(String[] args) {
        check(App.add(2, 3) == 5, "add must return the sum, not a - b");
        check(App.add(-1, 1) == 0, "zero-crossing");
        System.out.println("ORACLE_PASS:J04");
    }
}
