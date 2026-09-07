import java.util.Arrays;
import java.util.Collections;
public final class Oracle {
    private static void check(boolean ok, String message) {
        if (!ok) throw new AssertionError(message);
    }
    private static VerificationStatus.Run run(String rev, long time, Boolean passed) {
        return new VerificationStatus.Run(rev,time,passed);
    }
    public static void main(String[] args) {
        check(!VerificationStatus.isCurrentSuccess(Arrays.asList(run("A",1,true),run("B",2,false)),"B"),
            "old success must not override current failure");
        check(!VerificationStatus.isCurrentSuccess(Arrays.asList(run("B",10,false),run("B",9,true)),"B"),
            "latest evidence must win regardless of input order");
        check(VerificationStatus.isCurrentSuccess(Arrays.asList(run("A",20,false),run("B",19,true)),"B"),
            "other revision must not override current success");
        check(!VerificationStatus.isCurrentSuccess(Arrays.asList(run("B",1,true),run("B",2,null)),"B"),
            "latest unknown is not success");
        check(!VerificationStatus.isCurrentSuccess(Collections.<VerificationStatus.Run>emptyList(),"B"),
            "no evidence is not success");
        System.out.println("ORACLE_PASS:J07");
    }
}
