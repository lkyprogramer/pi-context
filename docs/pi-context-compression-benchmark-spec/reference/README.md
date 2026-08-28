# Reference Scorer

`reference_scorer.py` 是只依赖 Python 标准库的规范性参考，用来验证 paired delta、bootstrap CI、McNemar 表和词典序 W1 Gate。TypeScript 正式实现可以采用不同代码，但必须通过相同 golden vectors。

运行：

```bash
python3 -m unittest reference/test_reference_scorer.py -v
```
