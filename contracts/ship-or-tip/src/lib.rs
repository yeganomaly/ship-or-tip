#![no_std]

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, token, Address, Env, String,
};

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    Token,
    Build(String),
    Backed(String, Address),
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BuildStats {
    pub recipient: Address,
    pub total_tipped: i128,
    pub backer_count: u32,
}

#[contracterror]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum ContractError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    BuildAlreadyExists = 3,
    BuildNotFound = 4,
    InvalidAmount = 5,
}

#[contractevent(topics = ["TIP", "received"], data_format = "vec")]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TipReceived {
    pub build_id: String,
    pub backer: Address,
    pub recipient: Address,
    pub amount: i128,
    pub total_tipped: i128,
    pub backer_count: u32,
}

#[contract]
pub struct ShipOrTipContract;

#[contractimpl]
impl ShipOrTipContract {
    pub fn initialize(env: Env, admin: Address, token: Address) -> Result<(), ContractError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(ContractError::AlreadyInitialized);
        }

        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Token, &token);
        Ok(())
    }

    pub fn create_build(
        env: Env,
        build_id: String,
        recipient: Address,
    ) -> Result<BuildStats, ContractError> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(ContractError::NotInitialized)?;
        admin.require_auth();

        let key = DataKey::Build(build_id.clone());
        if env.storage().persistent().has(&key) {
            return Err(ContractError::BuildAlreadyExists);
        }

        let stats = BuildStats {
            recipient,
            total_tipped: 0,
            backer_count: 0,
        };
        env.storage().persistent().set(&key, &stats);
        Ok(stats)
    }

    pub fn tip(
        env: Env,
        build_id: String,
        backer: Address,
        amount: i128,
    ) -> Result<BuildStats, ContractError> {
        if amount <= 0 {
            return Err(ContractError::InvalidAmount);
        }

        backer.require_auth();
        let build_key = DataKey::Build(build_id.clone());
        let mut stats: BuildStats = env
            .storage()
            .persistent()
            .get(&build_key)
            .ok_or(ContractError::BuildNotFound)?;
        let token_address: Address = env
            .storage()
            .instance()
            .get(&DataKey::Token)
            .ok_or(ContractError::NotInitialized)?;

        token::TokenClient::new(&env, &token_address).transfer(&backer, &stats.recipient, &amount);

        let backer_key = DataKey::Backed(build_id.clone(), backer.clone());
        if !env.storage().persistent().has(&backer_key) {
            stats.backer_count += 1;
            env.storage().persistent().set(&backer_key, &true);
        }
        stats.total_tipped += amount;
        env.storage().persistent().set(&build_key, &stats);

        TipReceived {
            build_id,
            backer,
            recipient: stats.recipient.clone(),
            amount,
            total_tipped: stats.total_tipped,
            backer_count: stats.backer_count,
        }
        .publish(&env);

        Ok(stats)
    }

    pub fn get_build(env: Env, build_id: String) -> Result<BuildStats, ContractError> {
        env.storage()
            .persistent()
            .get(&DataKey::Build(build_id))
            .ok_or(ContractError::BuildNotFound)
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{testutils::Address as _, token, Address, Env, String};

    struct Fixture {
        env: Env,
        contract_id: Address,
        token_address: Address,
        recipient: Address,
        backer: Address,
        build_id: String,
    }

    fn fixture() -> Fixture {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register(ShipOrTipContract, ());
        let client = ShipOrTipContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let token_issuer = Address::generate(&env);
        let token_contract = env.register_stellar_asset_contract_v2(token_issuer);
        let token_address = token_contract.address();
        let token_admin = token::StellarAssetClient::new(&env, &token_address);
        let recipient = Address::generate(&env);
        let backer = Address::generate(&env);
        let build_id = String::from_str(&env, "ship-or-tip");

        client.initialize(&admin, &token_address);
        client.create_build(&build_id, &recipient);
        token_admin.mint(&backer, &50_000_000);

        Fixture {
            env,
            contract_id,
            token_address,
            recipient,
            backer,
            build_id,
        }
    }

    #[test]
    fn transfers_tip_and_updates_build_stats() {
        let f = fixture();
        let client = ShipOrTipContractClient::new(&f.env, &f.contract_id);
        let token = token::TokenClient::new(&f.env, &f.token_address);
        let stats = client.tip(&f.build_id, &f.backer, &10_000_000);

        assert_eq!(stats.total_tipped, 10_000_000);
        assert_eq!(stats.backer_count, 1);
        assert_eq!(token.balance(&f.recipient), 10_000_000);
        assert_eq!(token.balance(&f.backer), 40_000_000);

        let stored = client.get_build(&f.build_id);
        assert_eq!(stored, stats);
    }

    #[test]
    fn counts_a_repeat_backer_only_once() {
        let f = fixture();
        let client = ShipOrTipContractClient::new(&f.env, &f.contract_id);
        client.tip(&f.build_id, &f.backer, &10_000_000);
        let stats = client.tip(&f.build_id, &f.backer, &5_000_000);

        assert_eq!(stats.total_tipped, 15_000_000);
        assert_eq!(stats.backer_count, 1);
    }

    #[test]
    fn rejects_zero_amount() {
        let f = fixture();
        let client = ShipOrTipContractClient::new(&f.env, &f.contract_id);
        assert!(client.try_tip(&f.build_id, &f.backer, &0).is_err());
    }
}
