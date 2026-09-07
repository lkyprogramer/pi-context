public final class Routes {
    public static final String ORDERS = "/v1/orders";
    public static final String METHOD = "POST";
    public static String handle(String path, String method, String body) {
        if (ORDERS.equals(path) && METHOD.equals(method)) return "ok:" + body;
        return "no";
    }
}
