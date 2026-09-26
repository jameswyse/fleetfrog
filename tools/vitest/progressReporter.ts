const progressLineWidth = 50;

export class VitestProgressReporter {
  #completedTests = 0;

  onTestRunStart(): void {
    this.#completedTests = 0;
  }

  onTestCaseResult(): void {
    this.#completedTests += 1;

    if (this.#completedTests % progressLineWidth === 0) {
      console.log(".".repeat(progressLineWidth));
    }
  }

  onTestRunEnd(): void {
    const remainingTests = this.#completedTests % progressLineWidth;

    if (remainingTests !== 0) {
      console.log(".".repeat(remainingTests));
    }
  }
}
