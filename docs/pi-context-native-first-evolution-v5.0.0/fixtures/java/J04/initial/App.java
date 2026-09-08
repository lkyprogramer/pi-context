public final class App {
    // BUG: this returns a-b; oracle requires a+b
    public static int add(int a, int b) {
        return a - b;
    }
}
