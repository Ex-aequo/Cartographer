/** Binary min-heap of integer ids keyed by float priority. */
export class MinHeap {
  private ids: Int32Array;
  private keys: Float64Array;
  size = 0;
  constructor(capacity = 1024) {
    this.ids = new Int32Array(capacity);
    this.keys = new Float64Array(capacity);
  }
  push(id: number, key: number): void {
    if (this.size === this.ids.length) {
      const ni = new Int32Array(this.size * 2);
      ni.set(this.ids);
      this.ids = ni;
      const nk = new Float64Array(this.size * 2);
      nk.set(this.keys);
      this.keys = nk;
    }
    let i = this.size++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.keys[p] <= key) break;
      this.ids[i] = this.ids[p];
      this.keys[i] = this.keys[p];
      i = p;
    }
    this.ids[i] = id;
    this.keys[i] = key;
  }
  /** Key of the top element. */
  peekKey(): number {
    return this.keys[0];
  }
  pop(): number {
    const top = this.ids[0];
    const lastId = this.ids[--this.size];
    const lastKey = this.keys[this.size];
    let i = 0;
    const n = this.size;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= n) break;
      if (c + 1 < n && this.keys[c + 1] < this.keys[c]) c++;
      if (this.keys[c] >= lastKey) break;
      this.ids[i] = this.ids[c];
      this.keys[i] = this.keys[c];
      i = c;
    }
    this.ids[i] = lastId;
    this.keys[i] = lastKey;
    return top;
  }
}
