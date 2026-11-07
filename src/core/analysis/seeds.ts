/**
 * Train/test separation for random channels.
 *
 * Every threshold and constant of the receiver is tuned by looking at results
 * obtained with TUNING_SEEDS (the BER bench). Unit and end-to-end tests use
 * TEST_SEEDS only, so they check the receiver on channels it was never tuned
 * on — like a held-out test set in machine learning.
 */
export const TUNING_SEEDS: readonly number[] = Array.from({ length: 20 }, (_, i) => 1000 + i);

export const TEST_SEEDS: readonly number[] = [7001, 7002, 7003, 7004, 7005];
