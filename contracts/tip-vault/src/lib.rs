#![no_std]

use soroban_sdk::{
    contract, contractclient, contracterror, contractevent, contractimpl, contracttype, token,
    Address, Env, String,
};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum BuildStatus {
    Building,
    Shipped,
    Failed,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BuildRecord {
    pub creator: Address,
    pub deadline: u64,
    pub status: BuildStatus,
}

#[contractclient(name = "RegistryClient")]
pub trait Registry {
    fn get_build(env: Env, build_id: String) -> BuildRecord;
}

#[contracttype]
enum DataKey {
    Admin,
    Registry,
    Token,
    Total(String),
    Contribution(String, Address),
    Released(String),
}

#[contracterror]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum VaultError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    InvalidAmount = 3,
    BuildNotOpen = 4,
    DeadlinePassed = 5,
    NothingToRefund = 6,
    AlreadyReleased = 7,
    NotCreator = 8,
}

#[contractevent(topics = ["VAULT", "deposited"], data_format = "vec")]
pub struct TipDeposited {
    pub build_id: String,
    pub backer: Address,
    pub amount: i128,
    pub total: i128,
}

#[contractevent(topics = ["VAULT", "released"], data_format = "vec")]
pub struct FundsReleased {
    pub build_id: String,
    pub creator: Address,
    pub amount: i128,
}

#[contractevent(topics = ["VAULT", "refunded"], data_format = "vec")]
pub struct RefundClaimed {
    pub build_id: String,
    pub backer: Address,
    pub amount: i128,
}

#[contract]
pub struct TipVaultContract;

#[contractimpl]
impl TipVaultContract {
    pub fn initialize(env: Env, admin: Address, registry: Address, token: Address) -> Result<(), VaultError> {
        if env.storage().instance().has(&DataKey::Registry) {
            return Err(VaultError::AlreadyInitialized);
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Registry, &registry);
        env.storage().instance().set(&DataKey::Token, &token);
        Ok(())
    }

    pub fn tip(env: Env, build_id: String, backer: Address, amount: i128) -> Result<i128, VaultError> {
        if amount <= 0 {
            return Err(VaultError::InvalidAmount);
        }
        backer.require_auth();
        let registry: Address = env.storage().instance().get(&DataKey::Registry).ok_or(VaultError::NotInitialized)?;
        let build = RegistryClient::new(&env, &registry).get_build(&build_id);
        if build.status != BuildStatus::Building {
            return Err(VaultError::BuildNotOpen);
        }
        if env.ledger().timestamp() > build.deadline {
            return Err(VaultError::DeadlinePassed);
        }
        let token_address: Address = env.storage().instance().get(&DataKey::Token).ok_or(VaultError::NotInitialized)?;
        token::TokenClient::new(&env, &token_address).transfer(&backer, &env.current_contract_address(), &amount);

        let contribution_key = DataKey::Contribution(build_id.clone(), backer.clone());
        let contribution: i128 = env.storage().persistent().get(&contribution_key).unwrap_or(0);
        env.storage().persistent().set(&contribution_key, &(contribution + amount));
        let total_key = DataKey::Total(build_id.clone());
        let total: i128 = env.storage().persistent().get(&total_key).unwrap_or(0) + amount;
        env.storage().persistent().set(&total_key, &total);
        TipDeposited { build_id, backer, amount, total }.publish(&env);
        Ok(total)
    }

    pub fn release(env: Env, build_id: String, creator: Address) -> Result<i128, VaultError> {
        creator.require_auth();
        let registry: Address = env.storage().instance().get(&DataKey::Registry).ok_or(VaultError::NotInitialized)?;
        let build = RegistryClient::new(&env, &registry).get_build(&build_id);
        if build.creator != creator {
            return Err(VaultError::NotCreator);
        }
        if build.status != BuildStatus::Shipped {
            return Err(VaultError::BuildNotOpen);
        }
        if env.storage().persistent().get::<_, bool>(&DataKey::Released(build_id.clone())).unwrap_or(false) {
            return Err(VaultError::AlreadyReleased);
        }
        let total: i128 = env.storage().persistent().get(&DataKey::Total(build_id.clone())).unwrap_or(0);
        env.storage().persistent().set(&DataKey::Released(build_id.clone()), &true);
        let token_address: Address = env.storage().instance().get(&DataKey::Token).ok_or(VaultError::NotInitialized)?;
        token::TokenClient::new(&env, &token_address).transfer(&env.current_contract_address(), &creator, &total);
        FundsReleased { build_id, creator, amount: total }.publish(&env);
        Ok(total)
    }

    pub fn refund(env: Env, build_id: String, backer: Address) -> Result<i128, VaultError> {
        backer.require_auth();
        let registry: Address = env.storage().instance().get(&DataKey::Registry).ok_or(VaultError::NotInitialized)?;
        let build = RegistryClient::new(&env, &registry).get_build(&build_id);
        if build.status != BuildStatus::Failed && env.ledger().timestamp() <= build.deadline {
            return Err(VaultError::BuildNotOpen);
        }
        let key = DataKey::Contribution(build_id.clone(), backer.clone());
        let amount: i128 = env.storage().persistent().get(&key).unwrap_or(0);
        if amount <= 0 {
            return Err(VaultError::NothingToRefund);
        }
        env.storage().persistent().set(&key, &0_i128);
        let token_address: Address = env.storage().instance().get(&DataKey::Token).ok_or(VaultError::NotInitialized)?;
        token::TokenClient::new(&env, &token_address).transfer(&env.current_contract_address(), &backer, &amount);
        RefundClaimed { build_id, backer, amount }.publish(&env);
        Ok(amount)
    }

    pub fn total(env: Env, build_id: String) -> i128 {
        env.storage().persistent().get(&DataKey::Total(build_id)).unwrap_or(0)
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use build_registry::{BuildRegistryContract, BuildRegistryContractClient};
    use soroban_sdk::{testutils::Address as _, token, Address, Env, String};

    struct Fixture {
        env: Env,
        vault_id: Address,
        registry_id: Address,
        token_id: Address,
        creator: Address,
        backer: Address,
        build_id: String,
    }

    fn fixture() -> Fixture {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let creator = Address::generate(&env);
        let backer = Address::generate(&env);
        let issuer = Address::generate(&env);
        let token_contract = env.register_stellar_asset_contract_v2(issuer);
        let registry_id = env.register(BuildRegistryContract, ());
        let vault_id = env.register(TipVaultContract, ());
        let registry = BuildRegistryContractClient::new(&env, &registry_id);
        let vault = TipVaultContractClient::new(&env, &vault_id);
        let token_admin = token::StellarAssetClient::new(&env, &token_contract.address());
        let build_id = String::from_str(&env, "orange-build");
        registry.initialize(&admin);
        registry.create_build(&build_id, &creator, &1_000_000);
        vault.initialize(&admin, &registry_id, &token_contract.address());
        token_admin.mint(&backer, &100_000_000);
        Fixture { env, vault_id, registry_id, token_id: token_contract.address(), creator, backer, build_id }
    }

    #[test]
    fn deposits_tip_after_reading_registry() {
        let f = fixture();
        let vault = TipVaultContractClient::new(&f.env, &f.vault_id);
        let token = token::TokenClient::new(&f.env, &f.token_id);
        assert_eq!(vault.tip(&f.build_id, &f.backer, &10_000_000), 10_000_000);
        assert_eq!(token.balance(&f.vault_id), 10_000_000);
        assert_eq!(vault.total(&f.build_id), 10_000_000);
    }

    #[test]
    fn releases_escrow_after_registry_marks_shipped() {
        let f = fixture();
        let vault = TipVaultContractClient::new(&f.env, &f.vault_id);
        let registry = BuildRegistryContractClient::new(&f.env, &f.registry_id);
        let token = token::TokenClient::new(&f.env, &f.token_id);
        vault.tip(&f.build_id, &f.backer, &20_000_000);
        registry.mark_shipped(&f.build_id, &f.creator);
        assert_eq!(vault.release(&f.build_id, &f.creator), 20_000_000);
        assert_eq!(token.balance(&f.creator), 20_000_000);
        assert_eq!(token.balance(&f.vault_id), 0);
    }

    #[test]
    fn rejects_zero_amount() {
        let f = fixture();
        let vault = TipVaultContractClient::new(&f.env, &f.vault_id);
        assert_eq!(vault.try_tip(&f.build_id, &f.backer, &0), Err(Ok(VaultError::InvalidAmount)));
    }
}
