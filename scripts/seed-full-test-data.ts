import { DataSource } from 'typeorm';
import * as bcrypt from 'bcrypt';
import * as dotenv from 'dotenv';
import { v4 as uuidv4 } from 'uuid';
import { PaymentType } from '../src/modules/stores/entities/employee-contract.entity';
import { PayrollCalculationMethod } from '../src/modules/stores/entities/store-payroll-setting.entity';
import { PaymentCycle, ApplicableEmployees, ConfigStatus } from '../src/modules/stores/entities/salary-config.entity';

// Load .env file
dotenv.config();

async function seedFullTestData() {
  const dataSource = new DataSource({
    type: 'postgres',
    host: process.env.DATABASE_HOST,
    port: parseInt(process.env.DATABASE_PORT || '5432'),
    username: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
    database: process.env.DATABASE_NAME,
    entities: ['src/**/*.entity.{ts,js}'],
    synchronize: false,
  });

  try {
    await dataSource.initialize();
    console.log('✅ Database connected');

    // Repositories
    const accountRepo = dataSource.getRepository('Account');
    const storeRepo = dataSource.getRepository('Store');
    const employeeRepo = dataSource.getRepository('EmployeeProfile');
    const storeRoleRepo = dataSource.getRepository('StoreRole');
    const employeeTypeRepo = dataSource.getRepository('StoreEmployeeType');
    const workShiftRepo = dataSource.getRepository('WorkShift');
    const workCycleRepo = dataSource.getRepository('WorkCycle');
    const shiftSlotRepo = dataSource.getRepository('ShiftSlot');
    const shiftAssignmentRepo = dataSource.getRepository('ShiftAssignment');
    const salaryConfigRepo = dataSource.getRepository('SalaryConfig');
    const payrollSettingRepo = dataSource.getRepository('StorePayrollSetting');
    const employeeContractRepo = dataSource.getRepository('EmployeeContract');
    const employeeFaceRepo = dataSource.getRepository('EmployeeFace');

    const hashedPassword = await bcrypt.hash('Test123456', 10);

    // ============================================
    // 1. Create OWNER Account FIRST
    // ============================================
    let ownerAccount = await accountRepo.findOne({ where: { email: 'test_owner@timeso.com' } });
    
    if (!ownerAccount) {
      ownerAccount = accountRepo.create({
        fullName: 'Test Owner',
        phone: '0909000001',
        email: 'test_owner@timeso.com',
        passwordHash: hashedPassword,
        gender: 'male',
        status: 'active',
      });
      await accountRepo.save(ownerAccount);
      console.log('✅ Created OWNER account: test_owner@timeso.com');
    } else {
      console.log('⚠️  Owner account already exists');
    }

    // ============================================
    // 2. Create TEST STORE (with owner_account_id)
    // ============================================
    let store = await storeRepo.findOne({ where: { name: 'TEST_STORE_FULL_FLOW' } });
    
    if (!store) {
      store = storeRepo.create({
        ownerAccountId: ownerAccount.id,
        name: 'TEST_STORE_FULL_FLOW',
        address: '123 Test Street, HCMC',
        phone: '0909000000',
        latitude: 10.8231,
        longitude: 106.6297,
        status: 'active',
      });
      await storeRepo.save(store);
      console.log('✅ Created TEST_STORE_FULL_FLOW');
    } else {
      console.log('⚠️  Store already exists: TEST_STORE_FULL_FLOW');
    }

    // ============================================
    // 3. Create Store Roles
    // ============================================
    let ownerRole = await storeRoleRepo.findOne({ where: { storeId: store.id, name: 'Chủ cửa hàng' } });
    if (!ownerRole) {
      ownerRole = storeRoleRepo.create({
        storeId: store.id,
        name: 'Chủ cửa hàng',
        description: 'Chủ sở hữu cửa hàng',
        permissions: ['all'],
        isDefault: false,
      });
      await storeRoleRepo.save(ownerRole);
      console.log('✅ Created role: Chủ cửa hàng');
    }

    let staffRole = await storeRoleRepo.findOne({ where: { storeId: store.id, name: 'Nhân viên' } });
    if (!staffRole) {
      staffRole = storeRoleRepo.create({
        storeId: store.id,
        name: 'Nhân viên',
        description: 'Nhân viên bình thường',
        permissions: ['view_schedule', 'register_shift', 'check_in_out', 'view_payroll'],
        isDefault: true,
      });
      await storeRoleRepo.save(staffRole);
      console.log('✅ Created role: Nhân viên');
    }

    // ============================================
    // 4. Create Employee Type
    // ============================================
    let empType = await employeeTypeRepo.findOne({ where: { storeId: store.id, name: 'Full-time' } });
    if (!empType) {
      empType = employeeTypeRepo.create({
        storeId: store.id,
        name: 'Full-time',
        description: 'Nhân viên toàn thời gian',
        isDefault: true,
      });
      await employeeTypeRepo.save(empType);
      console.log('✅ Created employee type: Full-time');
    }

    // ============================================
    // 5. Create Owner Employee Profile
    // ============================================
    let ownerProfile = await employeeRepo.findOne({ 
      where: { storeId: store.id, accountId: ownerAccount.id } 
    });
    
    if (!ownerProfile) {
      ownerProfile = employeeRepo.create({
        storeId: store.id,
        accountId: ownerAccount.id,
        storeRoleId: ownerRole.id,
        employeeTypeId: empType.id,
        employmentStatus: 'active',
        workingStatus: 'idle',
        joinedAt: new Date(),
      });
      await employeeRepo.save(ownerProfile);
      console.log('✅ Created OWNER employee profile');
    } else {
      console.log('⚠️  Owner profile already exists');
    }

    // ============================================
    // 6. Create STAFF Account
    // ============================================
    let staffAccount = await accountRepo.findOne({ where: { email: 'test_staff@timeso.com' } });
    
    if (!staffAccount) {
      staffAccount = accountRepo.create({
        fullName: 'Test Staff',
        phone: '0909000002',
        email: 'test_staff@timeso.com',
        passwordHash: hashedPassword,
        gender: 'female',
        status: 'active',
      });
      await accountRepo.save(staffAccount);
      console.log('✅ Created STAFF account: test_staff@timeso.com');
    } else {
      console.log('⚠️  Staff account already exists');
    }

    // Create Staff Employee Profile
    let staffProfile = await employeeRepo.findOne({ 
      where: { storeId: store.id, accountId: staffAccount.id } 
    });
    
    if (!staffProfile) {
      staffProfile = employeeRepo.create({
        storeId: store.id,
        accountId: staffAccount.id,
        storeRoleId: staffRole.id,
        employeeTypeId: empType.id,
        employmentStatus: 'active',
        workingStatus: 'idle',
        joinedAt: new Date(),
      });
      await employeeRepo.save(staffProfile);
      console.log('✅ Created STAFF employee profile');
    } else {
      console.log('⚠️  Staff profile already exists');
    }

    // ============================================
    // 6b. Create Employee Contract (for staff - needed for payroll)
    // ============================================
    let contract: any = null;
    let contractFound = await employeeContractRepo.findOne({ 
      where: { employeeProfileId: staffProfile.id, isActive: true } 
    });
    if (!contractFound) {
      contract = employeeContractRepo.create({
        employeeProfileId: staffProfile.id,
        contractName: 'Hợp đồng Full-time',
        jobDescription: 'Nhân viên toàn thời gian',
        startDate: new Date(),
        endDate: new Date(new Date().setFullYear(new Date().getFullYear() + 1)),
        durationMonths: 12,
        weeklyWorkingHours: 44,
        paymentType: PaymentType.MONTH, // Vietnamese: 'Tháng'
        salaryAmount: 10000000, // 10,000,000 VND per month
        isActive: true,
      });
      await employeeContractRepo.save(contract);
      console.log('✅ Created Employee Contract for Staff');
    } else {
      contract = contractFound;
      console.log('⚠️  Employee contract already exists');
    }

    // ============================================
    // 6c. Create Employee Face (mock face descriptor for testing)
    // ============================================
    let employeeFace: any = null;
    let faceFound = await employeeFaceRepo.findOne({ 
      where: { employeeProfileId: staffProfile.id, isActive: true } 
    });
    if (!faceFound) {
      // Create a mock 128-dim face descriptor (all zeros for testing)
      // In production, this would be a real face embedding
      const mockDescriptor = new Array(128).fill(0).map(() => Math.random() * 0.4);
      
      employeeFace = employeeFaceRepo.create({
        employeeProfileId: staffProfile.id,
        storeId: store.id, // Required field
        faceDescriptors: [mockDescriptor],
        isActive: true,
        registeredAt: new Date(),
      });
      await employeeFaceRepo.save(employeeFace);
      console.log('✅ Created Employee Face (mock descriptor for testing)');
    } else {
      employeeFace = faceFound;
      console.log('⚠️  Employee face already exists');
    }

    // ============================================
    // 7. Create Payroll Setting
    // ============================================
    let payrollSetting: any = null;
    let payrollSettingFound = await payrollSettingRepo.findOne({ where: { storeId: store.id } });
    if (!payrollSettingFound) {
      payrollSetting = payrollSettingRepo.create({
        storeId: store.id,
        calculationMethod: PayrollCalculationMethod.FLEXIBLE, // Will use contract.paymentType to determine
      });
      await payrollSettingRepo.save(payrollSetting);
      console.log('✅ Created Payroll Setting');
    } else {
      payrollSetting = payrollSettingFound;
      console.log('⚠️  Payroll setting already exists');
    }

    // ============================================
    // 8. Create Salary Config (for owner)
    // ============================================
    let salaryConfig: any = null;
    let salaryConfigFound = await salaryConfigRepo.findOne({ where: { ownerAccountId: ownerAccount.id } });
    if (!salaryConfigFound) {
      salaryConfig = salaryConfigRepo.create({
        ownerAccountId: ownerAccount.id,
        storeIds: [store.id],
        paymentCycle: PaymentCycle.MONTHLY,
        applicablePaymentType: PaymentType.MONTH,
        applicableEmployees: ApplicableEmployees.ALL,
        status: ConfigStatus.ACTIVE,
        notes: 'Default salary config for testing',
      });
      await salaryConfigRepo.save(salaryConfig);
      console.log('✅ Created Salary Config');
    } else {
      salaryConfig = salaryConfigFound;
      console.log('⚠️  Salary config already exists');
    }

    // ============================================
    // 9. Create Work Shifts (Ca mẫu)
    // ============================================
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    
    // Ca Sáng
    let morningShift = await workShiftRepo.findOne({ 
      where: { storeId: store.id, shiftName: 'Ca Sáng (Test)' } 
    });
    if (!morningShift) {
      morningShift = workShiftRepo.create({
        storeId: store.id,
        shiftName: 'Ca Sáng (Test)',
        startTime: '08:00',
        endTime: '12:00',
        colorCode: '#4CAF50',
        defaultMaxStaff: 5,
        isActive: true,
      });
      await workShiftRepo.save(morningShift);
      console.log('✅ Created Work Shift: Ca Sáng (Test)');
    } else {
      console.log('⚠️  Morning shift already exists');
    }

    // Ca Chiều
    let afternoonShift = await workShiftRepo.findOne({ 
      where: { storeId: store.id, shiftName: 'Ca Chiều (Test)' } 
    });
    if (!afternoonShift) {
      afternoonShift = workShiftRepo.create({
        storeId: store.id,
        shiftName: 'Ca Chiều (Test)',
        startTime: '13:00',
        endTime: '17:00',
        colorCode: '#2196F3',
        defaultMaxStaff: 5,
        isActive: true,
      });
      await workShiftRepo.save(afternoonShift);
      console.log('✅ Created Work Shift: Ca Chiều (Test)');
    } else {
      console.log('⚠️  Afternoon shift already exists');
    }

    // Ca Tối
    let eveningShift = await workShiftRepo.findOne({ 
      where: { storeId: store.id, shiftName: 'Ca Tối (Test)' } 
    });
    if (!eveningShift) {
      eveningShift = workShiftRepo.create({
        storeId: store.id,
        shiftName: 'Ca Tối (Test)',
        startTime: '18:00',
        endTime: '22:00',
        colorCode: '#FF9800',
        defaultMaxStaff: 5,
        isActive: true,
      });
      await workShiftRepo.save(eveningShift);
      console.log('✅ Created Work Shift: Ca Tối (Test)');
    } else {
      console.log('⚠️  Evening shift already exists');
    }

    // ============================================
    // 10. Create Work Cycle (Chu kỳ)
    // ============================================
    const nextWeek = new Date(today);
    nextWeek.setDate(nextWeek.getDate() + 7);
    const nextWeekStr = nextWeek.toISOString().split('T')[0];

    let workCycle = await workCycleRepo.findOne({ 
      where: { storeId: store.id, name: 'Tuần Test (Seed)' } 
    });
    if (!workCycle) {
      const deadline = new Date(today);
      deadline.setDate(deadline.getDate() + 1);
      
      workCycle = workCycleRepo.create({
        storeId: store.id,
        name: 'Tuần Test (Seed)',
        cycleType: 'WEEKLY',
        startDate: todayStr,
        endDate: nextWeekStr,
        registrationDeadline: deadline,
        status: 'ACTIVE',
      });
      await workCycleRepo.save(workCycle);
      console.log('✅ Created Work Cycle: Tuần Test (Seed)');
    } else {
      console.log('⚠️  Work cycle already exists');
    }

    // ============================================
    // 11. Create Shift Slots (for today and tomorrow)
    // ============================================
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split('T')[0];

    const shifts = [morningShift, afternoonShift, eveningShift];
    const dates = [todayStr, tomorrowStr];

    for (const shift of shifts) {
      for (const date of dates) {
        let slot = await shiftSlotRepo.findOne({
          where: { cycleId: workCycle.id, workShiftId: shift.id, workDate: date }
        });
        if (!slot) {
          slot = shiftSlotRepo.create({
            cycleId: workCycle.id,
            workShiftId: shift.id,
            workDate: date,
            maxStaff: shift.defaultMaxStaff,
          });
          await shiftSlotRepo.save(slot);
          console.log(`✅ Created Shift Slot: ${shift.shiftName} - ${date}`);
        }
      }
    }

    // ============================================
    // 12. Create Shift Assignment (Staff đăng ký ca)
    // ============================================
    // Get today's slot for morning shift
    let assignment: any = null;
    const todaySlot = await shiftSlotRepo.findOne({
      where: { cycleId: workCycle.id, workShiftId: morningShift.id, workDate: todayStr }
    });

    if (todaySlot) {
      const existingAssignment = await shiftAssignmentRepo.findOne({
        where: { shiftSlotId: todaySlot.id, employeeId: staffProfile.id }
      });
      if (!existingAssignment) {
        assignment = shiftAssignmentRepo.create({
          shiftSlotId: todaySlot.id,
          employeeId: staffProfile.id,
          status: 'APPROVED', // Owner gán nên auto APPROVED
          note: 'Auto-assigned by seed script',
        });
        await shiftAssignmentRepo.save(assignment);
        console.log('✅ Created Shift Assignment for Staff (Approved)');
      } else {
        assignment = existingAssignment;
        console.log('⚠️  Shift assignment already exists');
      }
    }

    // ============================================
    // SUMMARY
    // ============================================
    console.log('\n═══════════════════════════════════════════════');
    console.log('              SEED COMPLETED');
    console.log('═══════════════════════════════════════════════');
    console.log(`Store ID:         ${store.id}`);
    console.log(`Owner Account:    ${ownerAccount.id}`);
    console.log(`Owner Profile:    ${ownerProfile?.id}`);
    console.log(`Staff Account:    ${staffAccount.id}`);
    console.log(`Staff Profile:    ${staffProfile.id}`);
    console.log(`Contract:         ${contract?.id || 'N/A'}`);
    console.log(`Employee Face:    ${employeeFace?.id || 'N/A'}`);
    console.log(`Work Cycle:       ${workCycle.id}`);
    console.log(`Morning Shift:    ${morningShift.id}`);
    console.log(`Shift Slot:       ${todaySlot?.id || 'N/A'}`);
    console.log(`Assignment:       ${assignment?.id || 'N/A'}`);
    console.log(`Payroll Setting:  ${payrollSetting?.id || 'N/A'}`);
    console.log(`Salary Config:    ${salaryConfig?.id || 'N/A'}`);
    console.log('───────────────────────────────────────────────');
    console.log('🔑 Test Credentials:');
    console.log('   Owner: test_owner@timeso.com / Test123456');
    console.log('   Staff: test_staff@timeso.com / Test123456');
    console.log('───────────────────────────────────────────────');
    console.log('📋 Test Flow:');
    console.log('   1. Login Owner → Create/Get Store');
    console.log('   2. Create Work Shifts & Cycle');
    console.log('   3. Login Staff → Register Shift');
    console.log('   4. Check-in/out with Face Recognition');
    console.log('   5. Generate Payroll');
    console.log('═══════════════════════════════════════════════\n');

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  } finally {
    await dataSource.destroy();
  }
}

seedFullTestData();
