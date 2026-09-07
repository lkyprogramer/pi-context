public final class Oracle {
    private static void check(boolean ok, String message) {
        if (!ok) throw new AssertionError(message);
    }
    public static void main(String[] args) {
        check("/v1/orders".equals(Routes.ORDERS), "HTTP path must stay /v1/orders");
        check("POST".equals(Routes.METHOD), "HTTP method must stay POST");
        check("ok:x".equals(Routes.handle("/v1/orders", "POST", "x")), "orders POST contract");
        check("no".equals(Routes.handle("/v1/orders", "GET", "x")), "GET must not be invented as success");
        System.out.println("ORACLE_PASS:J08");
    }
}
