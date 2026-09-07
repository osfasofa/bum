// A real AudioWorklet module, loaded from a real URL, to prove the worklet path works
// rather than merely checking that a constructor exists.
class BumProbe extends AudioWorkletProcessor {
  process() { return false; }   // never keeps itself alive; this only has to register
}
registerProcessor('bum-probe-file', BumProbe);
