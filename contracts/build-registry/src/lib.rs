#![no_std]

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, Address, Env, String,
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

#[contracttype]
enum DataKey {
    Admin,
    Build(String),
}

#[contracterror]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum RegistryError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    BuildAlreadyExists = 3,
    BuildNotFound = 4,
    InvalidDeadline = 5,
    InvalidStatus = 6,
    DeadlinePassed = 7,
    DeadlineNotReached = 8,
}

#[contractevent(topics = ["BUILD", "created"], data_format = "vec")]
pub struct BuildCreated {
    pub build_id: String,
    pub creator: Address,
    pub deadline: u64,
}

#[contractevent(topics = ["BUILD", "shipped"], data_format = "vec")]
pub struct BuildShipped {
    pub build_id: String,
    pub creator: Address,
}

#[contractevent(topics = ["BUILD", "failed"], data_format = "vec")]
pub struct BuildFailed {
    pub build_id: String,
}

#[contract]
pub struct BuildRegistryContract;

#[contractimpl]
impl BuildRegistryContract {
    pub fn initialize(env: Env, admin: Address) -> Result<(), RegistryError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(RegistryError::AlreadyInitialized);
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        Ok(())
    }

    pub fn create_build(
        env: Env,
        build_id: String,
        creator: Address,
        deadline: u64,
    ) -> Result<BuildRecord, RegistryError> {
        if !env.storage().instance().has(&DataKey::Admin) {
            return Err(RegistryError::NotInitialized);
        }
        creator.require_auth();
        if deadline <= env.ledger().timestamp() {
            return Err(RegistryError::InvalidDeadline);
        }
        let key = DataKey::Build(build_id.clone());
        if env.storage().persistent().has(&key) {
            return Err(RegistryError::BuildAlreadyExists);
        }
        let record = BuildRecord {
            creator: creator.clone(),
            deadline,
            status: BuildStatus::Building,
        };
        env.storage().persistent().set(&key, &record);
        BuildCreated { build_id, creator, deadline }.publish(&env);
        Ok(record)
    }

    pub fn mark_shipped(
        env: Env,
        build_id: String,
        creator: Address,
    ) -> Result<BuildRecord, RegistryError> {
        creator.require_auth();
        let key = DataKey::Build(build_id.clone());
        let mut record: BuildRecord = env.storage().persistent().get(&key).ok_or(RegistryError::BuildNotFound)?;
        if record.creator != creator || record.status != BuildStatus::Building {
            return Err(RegistryError::InvalidStatus);
        }
        if env.ledger().timestamp() > record.deadline {
            return Err(RegistryError::DeadlinePassed);
        }
        record.status = BuildStatus::Shipped;
        env.storage().persistent().set(&key, &record);
        BuildShipped { build_id, creator }.publish(&env);
        Ok(record)
    }

    pub fn mark_failed(env: Env, build_id: String) -> Result<BuildRecord, RegistryError> {
        let key = DataKey::Build(build_id.clone());
        let mut record: BuildRecord = env.storage().persistent().get(&key).ok_or(RegistryError::BuildNotFound)?;
        if record.status != BuildStatus::Building {
            return Err(RegistryError::InvalidStatus);
        }
        if env.ledger().timestamp() <= record.deadline {
            return Err(RegistryError::DeadlineNotReached);
        }
        record.status = BuildStatus::Failed;
        env.storage().persistent().set(&key, &record);
        BuildFailed { build_id }.publish(&env);
        Ok(record)
    }

    pub fn get_build(env: Env, build_id: String) -> Result<BuildRecord, RegistryError> {
        env.storage().persistent().get(&DataKey::Build(build_id)).ok_or(RegistryError::BuildNotFound)
    }
}

