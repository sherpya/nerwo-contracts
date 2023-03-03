import { expect } from 'chai';
import { deployments, ethers } from 'hardhat';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';

import { NerwoCentralizedArbitratorV1, NerwoEscrowV1, Rogue } from '../typechain-types';

import * as constants from '../constants';

describe('NerwoEscrow: reimburse', function () {
  let escrow: NerwoEscrowV1;
  let arbitrator: NerwoCentralizedArbitratorV1;
  let deployer: SignerWithAddress, platform: SignerWithAddress, court: SignerWithAddress;
  let sender: SignerWithAddress, receiver: SignerWithAddress;
  let rogue: Rogue;

  this.beforeEach(async () => {
    [deployer, platform, court, sender, receiver] = await ethers.getSigners();

    process.env.NERWO_COURT_ADDRESS = deployer.address;
    await deployments.fixture(['NerwoCentralizedArbitratorV1', 'NerwoEscrowV1']);

    let deployment = await deployments.get('NerwoCentralizedArbitratorV1');
    arbitrator = await ethers.getContractAt('NerwoCentralizedArbitratorV1', deployment.address);

    deployment = await deployments.get('NerwoEscrowV1');
    escrow = await ethers.getContractAt('NerwoEscrowV1', deployment.address);

    const Rogue = await ethers.getContractFactory("Rogue");
    rogue = await Rogue.deploy(escrow.address);
    await rogue.deployed();
  });

  it('rogue as recipient', async () => {
    let amount = ethers.utils.parseEther('0.002');

    const blockNumber = await ethers.provider.getBlockNumber();

    await expect(escrow.connect(sender).createTransaction(
      constants.TIMEOUT_PAYMENT, rogue.address, '', { value: amount }))
      .to.changeEtherBalances(
        [platform, sender],
        [0, -amount]
      )
      .to.emit(escrow, 'TransactionCreated');

    const events = await escrow.queryFilter(escrow.filters.TransactionCreated(), blockNumber);
    expect(events).to.be.an('array').that.lengthOf(1);
    expect(events[0].args!).is.not.undefined;

    const { _transactionID } = events[0].args!;

    await expect(escrow.connect(sender).pay(_transactionID, 0))
      .to.be.revertedWithCustomError(escrow, 'InvalidAmount').withArgs(amount);

    await expect(escrow.connect(sender).reimburse(_transactionID, amount))
      .to.be.revertedWithCustomError(escrow, 'InvalidCaller').withArgs(rogue.address);

    await expect(rogue.reimburse(_transactionID, 0))
      .to.be.revertedWithCustomError(escrow, 'InvalidAmount').withArgs(amount);

    await expect(rogue.reimburse(_transactionID, amount.mul(2)))
      .to.be.revertedWithCustomError(escrow, 'InvalidAmount').withArgs(amount);

    amount = amount.div(2);
    const feeAmount = amount.mul(constants.FEE_RECIPIENT_BASISPOINT).div(10000);

    await expect(rogue.reimburse(_transactionID, amount))
      .to.changeEtherBalances(
        [escrow, sender, rogue],
        [-amount, amount, 0]
      )
      .to.emit(escrow, 'Payment').withArgs(_transactionID, amount, rogue.address);

    await rogue.setAction(constants.RogueAction.Reimburse)
    await rogue.setAmount(amount);
    await expect(escrow.connect(sender).pay(_transactionID, amount))
      .to.changeEtherBalances(
        [escrow, platform, rogue],
        [-feeAmount, feeAmount, 0]
      )
      .to.emit(escrow, 'Payment').withArgs(_transactionID, amount, sender.address)
      .to.emit(escrow, 'FeeRecipientPayment').withArgs(_transactionID, feeAmount);

    await expect(rogue.reimburse(_transactionID, amount))
      .to.be.revertedWithCustomError(escrow, 'InvalidAmount').withArgs(0);
  });

  it('rogue as sender', async () => {
    let amount = ethers.utils.parseEther('0.002');

    // fund rogue contract
    const rogueFunds = ethers.utils.parseEther('10.0');
    await expect(sender.sendTransaction({ to: rogue.address, value: rogueFunds }))
      .to.changeEtherBalance(rogue, rogueFunds);

    await rogue.setAmount(amount);

    const blockNumber = await ethers.provider.getBlockNumber();
    await expect(rogue.createTransaction(
      constants.TIMEOUT_PAYMENT, receiver.address, ''))
      .to.changeEtherBalances(
        [platform, rogue],
        [0, -amount]
      )
      .to.emit(escrow, 'TransactionCreated');

    const events = await escrow.queryFilter(escrow.filters.TransactionCreated(), blockNumber);
    expect(events).to.be.an('array').that.lengthOf(1);
    expect(events[0].args!).is.not.undefined;

    const { _transactionID } = events[0].args!;

    await expect(rogue.pay(_transactionID, 0))
      .to.be.revertedWithCustomError(escrow, 'InvalidAmount').withArgs(amount);

    await expect(rogue.reimburse(_transactionID, amount))
      .to.be.revertedWithCustomError(escrow, 'InvalidCaller').withArgs(receiver.address);

    await expect(escrow.connect(receiver).reimburse(_transactionID, 0))
      .to.be.revertedWithCustomError(escrow, 'InvalidAmount').withArgs(amount);

    await expect(escrow.connect(receiver).reimburse(_transactionID, amount.mul(2)))
      .to.be.revertedWithCustomError(escrow, 'InvalidAmount').withArgs(amount);

    amount = amount.div(2);
    const feeAmount = amount.mul(constants.FEE_RECIPIENT_BASISPOINT).div(10000);

    await expect(escrow.connect(receiver).reimburse(_transactionID, amount))
      .to.changeEtherBalances(
        [escrow, rogue],
        [-amount, amount]
      )
      .to.emit(escrow, 'Payment').withArgs(_transactionID, amount, receiver.address);

    await expect(rogue.pay(_transactionID, amount))
      .to.changeEtherBalances(
        [escrow, platform, rogue, receiver],
        [-amount, feeAmount, 0, amount.sub(feeAmount)]
      )
      .to.emit(escrow, 'Payment').withArgs(_transactionID, amount, rogue.address)
      .to.emit(escrow, 'FeeRecipientPayment').withArgs(_transactionID, feeAmount);

    await expect(escrow.connect(receiver).reimburse(_transactionID, amount))
      .to.be.revertedWithCustomError(escrow, 'InvalidAmount').withArgs(0);
  });

});
