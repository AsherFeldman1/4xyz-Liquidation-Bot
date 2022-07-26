const Web3 = require("web3");
const dotenv = require("dotenv");

const IFxVaultsABI = require(__dirname + '/../Interface/IFxVaults.json');
const IOrderBookABI = require(__dirname + '/../Interface/IOrderBook.json');
const ILiquidatorABI = require(__dirname + '/../Interface/ILiquidator.json');

dotenv.config();

if (process.env.WEB3_HTTP_PROVIDER_URL === null || process.env.WEB3_HTTP_PROVIDER_URL === undefined) {
	console.error("Invalid Web3 http provider url", process.env.WEB3_HTTP_PROVIDER_URL);
	process.exit();
}

var web3 = new Web3(new Web3.providers.HttpProvider(process.env.WEB3_HTTP_PROVIDER_URL));

const vaults = new web3.eth.Contract(IFxVaultsABI.abi, process.env.VAULTS_ADDRESS);
const liquidator = new web3.eth.Contract(ILiquidatorABI.abi, process.env.LIQUIDATOR_ADDRESS);
const exchange = new web3.eth.Contract(IOrderBookABI.abi, process.env.ORDERBOOK_ADDRESS);

const vaultsClosed = [];

const _0 = new BN(0);
const _10To18 = (new BN(10)).pow(new BN(18));

const aaveFee = (new BN(10)).pow(new BN(14)).mul(new BN(9));

const orderbookIndex = process.env.ORDERBOOK_INDEX;
const minimumProfit = process.env.MINIMUM_PROFIT;

async function getBestAsk() {
	let orderID = await exchange.methods.getSellHead(orderbookIndex);
	let ask = await exchange.methods.getSell(orderID);
	if (ask.price == _0) {
		throw new Error("No liquidity to trade for debt on order book.");
	}
	return ask.price;
}

async function liquidateAllPossible() {

	let account = web3.eth.accounts.privateKeyToAccount(process.env.ETHEREUM_ADMIN_PRIVATE_KEY);
	let accounts = await web3.eth.getAccounts();
	if (web3.eth.defaultAccount === null || typeof(web3.eth.defaultAccount) === "undefined") {
		console.log('setting default account');
		web3.eth.defaultAccount = accounts[0];
	}
	let defaultAccount = await web3.eth.defaultAccount;
	if (defaultAccount !== process.env.ETHEREUM_ADMIN_ACCOUNT) {
		console.error("default account was not the same as env.ETHEREUM_ADMIN_ACCOUNT");
		process.exit();
	}

	let maxID = await vaults.methods.getID();
	for (let i = 0; i < maxID; i++) {
		if (vaultsClosed.includes(i)) {
			continue;
		}
		let vault = await vaults.methods.getVault(i);
		if (vault.closed == true) {
			vaultsClosed.push(i);
			continue;
		}
		let liquidationDetected = await vaults.methods.detectLiquidation(i);
		if (!liquidationDetected) {
			continue;
		}
		let price = await getBestAsk();
		let flashLoanAmount = price.mul(vault.debt).div(_10To18);
		let profit = vault.collateral.sub(flashLoanAmount);
		let fee = flashLoanAmount.mul(aaveFee).div(_10to18);
		if (fee > profit.add(minimumProfit)) {
			continue;
		}
		let txn = await liquidator.methods.liquidate(i, orderbookIndex, price, vault.debt);
		let gas = await txn.estimateGas();
		await txn.send({from: accounts[0], gas});
	}
}

function sleep(seconds) {
  let ms = seconds * 1000;
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
	try {
		while(true) {
			await liquidateAllPossible();
			await sleep(process.env.LIQUIDATION_FREQUENCY);
		}
	}
	catch(err) {
		console.log(err);
	}
}

main();