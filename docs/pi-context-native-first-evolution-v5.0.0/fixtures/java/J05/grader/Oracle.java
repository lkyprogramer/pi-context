public final class Oracle {
    public static void main(String[] args) {
        String token = NonceBox.token();
        if (token == null || token.length() < 8 || "REPLACE_ME".equals(token)) {
            throw new AssertionError("nonce not installed");
        }
        System.out.println("ORACLE_PASS:J05:" + token);
    }
}
