import java.nio.file.Files;
import java.nio.file.Paths;
public final class Oracle {
    public static void main(String[] args) throws Exception {
        String src = new String(Files.readAllBytes(Paths.get("Writer.java")));
        if (src.contains("schema_forbidden") || src.contains("other_schema")) {
            throw new AssertionError("cross-schema write leaked from the other branch");
        }
        if (!"app".equals(Writer.targetSchema())) {
            throw new AssertionError("branch B must keep schema app");
        }
        System.out.println("ORACLE_PASS:J06");
    }
}
